/**
 * geometry.ts — Computational geometry functions.
 *
 * Uses d3-polygon for standard operations (point-in-polygon, convex hull)
 * and implements concave hull (Moreira & Santos 2007) from scratch since
 * no standard library provides it.
 */

import type { Point } from './types'
import { polygonContains, polygonHull } from 'd3-polygon'

// ── Primitives (internal) ───────────────────────────────────

function dist2(a: Point, b: Point): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

function ptDist(a: Point, b: Point): number {
  return Math.sqrt(dist2(a, b))
}

function ptAngle(a: Point, b: Point): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

// ── Segment intersection (internal) ─────────────────────────

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

// ── Point-in-polygon (d3-polygon) ───────────────────────────

/** Delegates to d3-polygon's polygonContains (ray-casting). */
export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  return polygonContains(polygon, pt)
}

// ── Convex hull (d3-polygon) ────────────────────────────────

/** Delegates to d3-polygon's polygonHull (Andrew's monotone chain). */
function convexHull(points: Point[]): Point[] {
  const hull = polygonHull(points)
  return hull ? [...hull] : points
}

// ── k-NN index (internal) ───────────────────────────────────

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

/**
 * Attempts to build a concave hull with a specific k value.
 * Walks clockwise from the bottommost point, picking the best
 * candidate among k nearest neighbors at each step.
 */
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
        let turn = prevAngle - angle
        while (turn < 0) turn += Math.PI * 2
        while (turn >= Math.PI * 2) turn -= Math.PI * 2
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

  return null // Loop exhausted without closing
}

/** Returns true if the closing edge (from → start) doesn't cross any existing hull edge. */
function canCloseLoop(hull: Point[], from: Point, start: Point): boolean {
  for (let i = 0; i < hull.length - 1; i++) {
    if (i === hull.length - 2) continue // skip the edge adjacent to 'from'
    if (segmentsIntersect(from, start, hull[i], hull[i + 1])) return false
  }
  return true
}

/** Returns true if extending the hull from `from` to `nextPoint` doesn't cross any existing hull edge. */
function canExtendTo(hull: Point[], from: Point, nextPoint: Point): boolean {
  for (let i = 0; i < hull.length - 1; i++) {
    if (segmentsIntersect(from, nextPoint, hull[i], hull[i + 1])) return false
  }
  return true
}

/** Validates: no self-intersections, all points inside or on the hull. */
function validateHull(hull: Point[], points: Point[]): boolean {
  if (hull.length < 3) return false

  // Self-intersection check
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    for (let j = i + 2; j < hull.length; j++) {
      if (i === 0 && j === hull.length - 1) continue
      if (segmentsIntersect(a, b, hull[j], hull[(j + 1) % hull.length])) return false
    }
  }

  // All-points-contained check
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
 * Computes a concave hull using k-nearest neighbors (Moreira & Santos 2007).
 * Tries increasing k values; falls back to d3-polygon's convex hull.
 */
export function concaveHull(points: Point[], kStart: number): Point[] {
  if (points.length < 3) return points

  const knnIndex = buildKnnIndex(points)

  // Start from the bottommost point (highest y), then leftmost
  let startIdx = 0
  for (let i = 1; i < points.length; i++) {
    if (points[i][1] > points[startIdx][1] ||
        (points[i][1] === points[startIdx][1] && points[i][0] < points[startIdx][0])) {
      startIdx = i
    }
  }

  for (let k = Math.max(kStart, 4); k <= Math.min(points.length - 1, 8); k++) {
    const hull = tryHull(points, knnIndex, startIdx, k)
    if (hull && validateHull(hull, points)) return hull
  }

  return convexHull(points)
}
