import type { Point, TriangleInfo } from './geometry'
import { pointInTriangle } from './geometry'
import { pointInConvexHull } from './hull'

/** Max points to insert per refinement step (prevents UI freezing) */
const MAX_INSERTIONS_PER_STEP = 12

/** Minimum squared distance between any two points (10px) */
const MIN_DISTANCE_SQ = 100

/** Find the midpoint of the longest edge of a triangle */
function longestEdgeMidpoint(p1: Point, p2: Point, p3: Point): Point {
  const edges: [Point, Point][] = [[p1, p2], [p2, p3], [p1, p3]]

  let longestEdge = edges[0]
  let longestLenSq = 0

  for (const [a, b] of edges) {
    const lenSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
    if (lenSq > longestLenSq) {
      longestLenSq = lenSq
      longestEdge = [a, b]
    }
  }

  return {
    x: (longestEdge[0].x + longestEdge[1].x) / 2,
    y: (longestEdge[0].y + longestEdge[1].y) / 2
  }
}

/** Compute the centroid (average of 3 vertices) */
function centroid(p1: Point, p2: Point, p3: Point): Point {
  return {
    x: (p1.x + p2.x + p3.x) / 3,
    y: (p1.y + p2.y + p3.y) / 3
  }
}

/**
 * Choose where to insert a new point inside a bad triangle (Ruppert's strategy):
 *
 *  1. Circumcenter — the ideal choice, maximizes angle improvement.
 *     Only used if it falls INSIDE the triangle (acute triangles).
 *
 *  2. Midpoint of longest edge — fallback for obtuse triangles where
 *     the circumcenter lies outside the triangle.
 *
 *  3. Centroid — last resort when circumcircle computation failed
 *     (degenerate/collinear triangle).
 */
function pickInsertionPoint(tri: TriangleInfo): Point | null {
  const { p1, p2, p3, cc } = tri

  if (cc) {
    // Try circumcenter first — best for angle improvement
    const circumcenter = { x: cc.x, y: cc.y }
    if (pointInTriangle(circumcenter.x, circumcenter.y, p1, p2, p3)) {
      return circumcenter
    }

    // Circumcenter is outside → use midpoint of longest edge instead
    return longestEdgeMidpoint(p1, p2, p3)
  }

  // No valid circumcircle → fall back to centroid
  return centroid(p1, p2, p3)
}

/** Check if a candidate point is too close to any existing point */
function isTooClose(candidate: Point, existingPoints: Point[]): boolean {
  return existingPoints.some(
    p => (p.x - candidate.x) ** 2 + (p.y - candidate.y) ** 2 < MIN_DISTANCE_SQ
  )
}

/**
 * Run one refinement pass (Ruppert's algorithm):
 *  1. Find all bad triangles (area too big or min angle too small)
 *  2. Sort by area descending (fix the worst first)
 *  3. For each, pick an insertion point and validate it:
 *     - Must be inside the original convex hull
 *     - Must not be too close to existing points
 *  4. Return the new points to be added to the mesh
 */
export function refineOnce(
  triangleData: TriangleInfo[],
  allPoints: Point[],
  hull: Point[]
): Point[] {
  // Step 1 & 2: Get bad triangles, worst (largest) first
  const badTriangles = triangleData
    .filter(t => t.bad)
    .sort((a, b) => b.area - a.area)

  if (badTriangles.length === 0) return []

  // Step 3: Pick and validate insertion points
  const newPoints: Point[] = []

  for (const tri of badTriangles) {
    if (newPoints.length >= MAX_INSERTIONS_PER_STEP) break

    const candidate = pickInsertionPoint(tri)
    if (!candidate || !isFinite(candidate.x) || !isFinite(candidate.y)) continue

    // Must be inside the original point cloud boundary
    if (!pointInConvexHull(candidate, hull)) continue

    // Must not be too close to any existing or newly-added point
    if (isTooClose(candidate, [...allPoints, ...newPoints])) continue

    newPoints.push(candidate)
  }

  return newPoints
}
