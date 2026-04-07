/**
 * geometry.ts
 *
 * Geometry primitives and the concave hull algorithm (Moreira & Santos 2007).
 * Standard operations like point-in-polygon and convex hull are delegated to
 * d3-polygon, while the concave hull is implemented here since no library
 * provides one.
 */

import type { Point } from './types'
import { polygonContains, polygonHull } from 'd3-polygon'

// ── Primitives ─────────────────────────────────────────────

/** Squared distance between two points (avoids sqrt when only comparing). */
function dist2(a: Point, b: Point): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

/** Euclidean distance. */
function ptDist(a: Point, b: Point): number {
  return Math.sqrt(dist2(a, b))
}

/** Angle from a to b in radians. */
function ptAngle(a: Point, b: Point): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

/** 2D cross product of vectors (o->a) and (o->b). Positive when b is left of o->a. */
function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** Wraps an angle into [0, 2pi). */
export function normalizeAngle(angle: number): number {
  const TWO_PI = Math.PI * 2
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

/**
 * Scans through points and returns the one with the smallest y coordinate.
 * When two points share the same y, the one further left (smaller x) wins.
 */
export function findTopLeft(points: Point[]): { point: Point; index: number } {
  let bestIndex = 0
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]
    const [bestX, bestY] = points[bestIndex]
    if (y < bestY || (y === bestY && x < bestX)) {
      bestIndex = i
    }
  }
  return { point: points[bestIndex], index: bestIndex }
}

/**
 * Same idea as findTopLeft but picks the largest y instead, so the
 * bottommost-leftmost point. The concave hull walk starts from here.
 */
export function findBottomLeft(points: Point[]): { point: Point; index: number } {
  let bestIndex = 0
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]
    const [bestX, bestY] = points[bestIndex]
    if (y > bestY || (y === bestY && x < bestX)) {
      bestIndex = i
    }
  }
  return { point: points[bestIndex], index: bestIndex }
}

// ── Segment intersection ───────────────────────────────────

/** True when segments (p1,p2) and (p3,p4) cross. Shared endpoints don't count. */
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  if ((p1[0] === p3[0] && p1[1] === p3[1]) ||
      (p1[0] === p4[0] && p1[1] === p4[1]) ||
      (p2[0] === p3[0] && p2[1] === p3[1]) ||
      (p2[0] === p4[0] && p2[1] === p4[1])) {
    return false
  }
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

// ── Wrappers around d3-polygon ─────────────────────────────

/** Ray-casting point-in-polygon via d3. */
export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  return polygonContains(polygon, pt)
}

/** Convex hull via d3 (Andrew's monotone chain). */
function convexHull(points: Point[]): Point[] {
  const hull = polygonHull(points)
  return hull ? [...hull] : points
}

// ── k-NN index ─────────────────────────────────────────────

/**
 * For each point, precomputes a sorted list of all other points by distance.
 * The concave hull algorithm needs fast k-nearest-neighbor lookups at every
 * step, so building this index up front avoids repeated sorting.
 */
function buildKnnIndex(points: Point[]): number[][] {
  const n = points.length
  const index: number[][] = new Array(n)
  for (let i = 0; i < n; i++) {
    const dists: { idx: number; d: number }[] = []
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      dists.push({ idx: j, d: dist2(points[i], points[j]) })
    }
    dists.sort((a, b) => a.d - b.d)
    index[i] = dists.map(x => x.idx)
  }
  return index
}

// ── Concave hull (Moreira & Santos 2007) ────────────────────
//
// The algorithm walks clockwise from the bottommost point. At each step
// it looks at the k nearest neighbors and picks the one that turns the
// least (i.e. continues most clockwise) without crossing an existing
// hull edge. If the walk returns to the start, we have a hull.

/** Single attempt at building a concave hull with a given k. */
function tryHull(
  points: Point[],
  knnIndex: number[][],
  startIdx: number,
  k: number
): Point[] | null {
  const hull: Point[] = [points[startIdx]]
  const used = new Set<number>([startIdx])
  let currentIdx = startIdx
  let prevAngle = Math.PI

  for (let step = 0; step < points.length; step++) {
    const neighbors = knnIndex[currentIdx].slice(0, k)

    const candidates = neighbors
      .map(neighborIdx => {
        const angle = ptAngle(points[currentIdx], points[neighborIdx])
        const turn = normalizeAngle(prevAngle - angle)
        return { idx: neighborIdx, angle, turn }
      })
      .sort((a, b) => a.turn - b.turn)

    let found = false
    for (const cand of candidates) {
      if (cand.idx === startIdx && hull.length >= 3) {
        if (canCloseLoop(hull, points[currentIdx], points[startIdx])) return hull
        continue
      }

      if (used.has(cand.idx)) continue

      const nextPoint = points[cand.idx]
      if (canExtendTo(hull, points[currentIdx], nextPoint)) {
        hull.push(nextPoint)
        used.add(cand.idx)
        prevAngle = ptAngle(nextPoint, points[currentIdx])
        currentIdx = cand.idx
        found = true
        break
      }
    }

    if (!found) return null
  }

  return null
}

/** Check that closing the loop (from -> start) won't cross existing edges. */
function canCloseLoop(hull: Point[], from: Point, start: Point): boolean {
  for (let i = 0; i < hull.length - 1; i++) {
    if (i === hull.length - 2) continue
    if (segmentsIntersect(from, start, hull[i], hull[i + 1])) return false
  }
  return true
}

/** Check that extending (from -> nextPoint) won't cross existing edges. */
function canExtendTo(hull: Point[], from: Point, nextPoint: Point): boolean {
  for (let i = 0; i < hull.length - 1; i++) {
    if (segmentsIntersect(from, nextPoint, hull[i], hull[i + 1])) return false
  }
  return true
}

/**
 * Validates a hull by checking two things: no edges cross each other,
 * and every input point falls inside or on the boundary (within a small
 * tolerance to handle floating-point edge cases).
 */
function validateHull(hull: Point[], points: Point[]): boolean {
  if (hull.length < 3) return false

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    for (let j = i + 2; j < hull.length; j++) {
      if (i === 0 && j === hull.length - 1) continue
      if (segmentsIntersect(a, b, hull[j], hull[(j + 1) % hull.length])) return false
    }
  }

  const TOLERANCE = 0.5
  for (const pt of points) {
    if (pointInPolygon(pt, hull)) continue

    let onEdge = false
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]
      const b = hull[(i + 1) % hull.length]
      const d = Math.abs(cross(a, b, pt)) / ptDist(a, b)
      if (d < TOLERANCE &&
          Math.min(a[0], b[0]) - TOLERANCE <= pt[0] && pt[0] <= Math.max(a[0], b[0]) + TOLERANCE &&
          Math.min(a[1], b[1]) - TOLERANCE <= pt[1] && pt[1] <= Math.max(a[1], b[1]) + TOLERANCE) {
        onEdge = true
        break
      }
    }
    if (!onEdge) return false
  }

  return true
}

/**
 * Tries concave hull with increasing k (from kStart up to 8). If none of
 * the attempts produce a valid hull, falls back to d3's convex hull.
 */
export function concaveHull(points: Point[], kStart: number): Point[] {
  if (points.length < 3) return points

  const knnIndex = buildKnnIndex(points)

  const { index: startIdx } = findBottomLeft(points)

  for (let k = Math.max(kStart, 4); k <= Math.min(points.length - 1, 8); k++) {
    const hull = tryHull(points, knnIndex, startIdx, k)
    if (hull && validateHull(hull, points)) return hull
  }

  return convexHull(points)
}
