/**
 * geometry.ts — Pure computational geometry functions.
 *
 * Contains primitives (distance, angle, cross product), intersection tests,
 * point-in-polygon queries, and hull algorithms (concave + convex).
 * All functions are stateless and operate only on Point tuples.
 */

import type { Point } from './types'

// ── Primitives ──────────────────────────────────────────────

/** Squared Euclidean distance (avoids sqrt for comparison use). */
export function dist2(a: Point, b: Point): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

/** Euclidean distance between two points. */
export function ptDist(a: Point, b: Point): number {
  return Math.sqrt(dist2(a, b))
}

/** Angle (radians) from point `a` to point `b`. */
export function ptAngle(a: Point, b: Point): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

/**
 * Cross product of vectors OA and OB.
 * Positive → counter-clockwise, negative → clockwise, zero → collinear.
 */
export function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

// ── Segment intersection ────────────────────────────────────

/**
 * Tests whether segments (p1–p2) and (p3–p4) properly intersect.
 * Returns false if they share an endpoint (adjacency is not intersection).
 */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  // Shared endpoint → not a proper intersection
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

// ── Point-in-polygon ────────────────────────────────────────

/**
 * Ray-casting algorithm: casts a horizontal ray from `pt` to the right
 * and counts how many polygon edges it crosses. Odd count → inside.
 */
export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

// ── k-NN index ──────────────────────────────────────────────

/**
 * For each point, pre-computes a sorted list of all other point indices
 * ordered by distance (nearest first). Used by the concave hull algorithm
 * to quickly find the k closest neighbors at each step.
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

/**
 * Attempts to build a concave hull with a specific k value.
 *
 * Starting from the bottommost point, the algorithm walks clockwise:
 * at each step it picks the k nearest neighbors, sorts them by
 * right-hand turn angle, and selects the first candidate whose edge
 * doesn't intersect existing hull edges. Returns null if it gets stuck.
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
  let prevAngle = Math.PI // Initial direction: pointing left

  for (let step = 0; step < points.length; step++) {
    const neighbors = knnIndex[currentIdx].slice(0, k)

    // Sort neighbors by clockwise turn from current heading
    const candidates = neighbors
      .map(nIdx => {
        const a = ptAngle(points[currentIdx], points[nIdx])
        let turn = prevAngle - a
        while (turn < 0) turn += Math.PI * 2
        while (turn >= Math.PI * 2) turn -= Math.PI * 2
        return { idx: nIdx, angle: a, turn }
      })
      .sort((a, b) => a.turn - b.turn)

    let found = false
    for (const cand of candidates) {
      // Try closing the hull back to the start
      if (cand.idx === startIdx && hull.length >= 3) {
        let closingEdgeOk = true
        for (let i = 0; i < hull.length - 1; i++) {
          if (i === hull.length - 2) continue // Skip adjacent edge
          if (segmentsIntersect(points[currentIdx], points[startIdx], hull[i], hull[i + 1])) {
            closingEdgeOk = false
            break
          }
        }
        if (closingEdgeOk) return hull
        continue
      }

      if (used.has(cand.idx)) continue

      // Check that the new edge doesn't cross any existing hull edge
      const newPt = points[cand.idx]
      let intersects = false
      for (let i = 0; i < hull.length - 1; i++) {
        if (segmentsIntersect(points[currentIdx], newPt, hull[i], hull[i + 1])) {
          intersects = true
          break
        }
      }
      if (intersects) continue

      // Accept this candidate
      hull.push(newPt)
      used.add(cand.idx)
      prevAngle = ptAngle(newPt, points[currentIdx])
      currentIdx = cand.idx
      found = true
      break
    }

    if (!found) return null // Dead end — this k doesn't work
  }

  return null // Didn't close within point count
}

/**
 * Validates a hull by checking:
 * 1. No self-intersecting edges
 * 2. All input points are inside the hull (or within tolerance of an edge)
 */
function validateHull(hull: Point[], points: Point[]): boolean {
  if (hull.length < 3) return false

  // Self-intersection check
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    for (let j = i + 2; j < hull.length; j++) {
      if (i === 0 && j === hull.length - 1) continue // Adjacent edges
      const c = hull[j]
      const d = hull[(j + 1) % hull.length]
      if (segmentsIntersect(a, b, c, d)) return false
    }
  }

  // All-points-contained check
  const EDGE_TOLERANCE = 0.5
  for (const pt of points) {
    if (pointInPolygon(pt, hull)) continue

    // Point might be exactly on an edge — check distance to each edge
    let onEdge = false
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]
      const b = hull[(i + 1) % hull.length]
      const distToEdge = Math.abs(cross(a, b, pt)) / ptDist(a, b)
      const withinBounds =
        Math.min(a[0], b[0]) - EDGE_TOLERANCE <= pt[0] && pt[0] <= Math.max(a[0], b[0]) + EDGE_TOLERANCE &&
        Math.min(a[1], b[1]) - EDGE_TOLERANCE <= pt[1] && pt[1] <= Math.max(a[1], b[1]) + EDGE_TOLERANCE
      if (distToEdge < EDGE_TOLERANCE && withinBounds) {
        onEdge = true
        break
      }
    }
    if (!onEdge) return false
  }

  return true
}

/**
 * Computes a concave hull of the given points using the k-nearest
 * neighbors algorithm (Moreira & Santos 2007).
 *
 * Tries increasing values of k (from kStart up to 8). Higher k produces
 * a smoother (more convex) hull; lower k produces a tighter boundary.
 * Falls back to convex hull if no valid concave hull is found.
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

  // Try increasing k until we get a valid hull
  for (let k = Math.max(kStart, 4); k <= Math.min(points.length - 1, 8); k++) {
    const hull = tryHull(points, knnIndex, startIdx, k)
    if (hull && validateHull(hull, points)) return hull
  }

  return convexHull(points)
}

// ── Convex hull (Andrew's monotone chain) ───────────────────

/**
 * Computes the convex hull using Andrew's monotone chain algorithm.
 * Used as a fallback when the concave hull algorithm fails.
 */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])

  // Build lower hull (left to right)
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }

  // Build upper hull (right to left)
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }

  // Remove last point of each half (it's the first point of the other)
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
