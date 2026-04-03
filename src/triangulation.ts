import { EPSILON, circumcircle } from './geometry'
import type { Point } from './geometry'

export interface Triangle {
  p: [Point, Point, Point]
}

/** Check if a point lies inside a triangle's circumcircle */
function isInsideCircumcircle(point: Point, tri: Triangle): boolean {
  const cc = circumcircle(tri.p[0], tri.p[1], tri.p[2])
  if (!cc) return false

  const distToCenter = (point.x - cc.x) ** 2 + (point.y - cc.y) ** 2
  const radiusSq = cc.r ** 2

  return distToCenter <= radiusSq + EPSILON
}

/** Check if two edges are the same (in either direction) */
function edgesMatch(e1: [Point, Point], e2: [Point, Point]): boolean {
  return (e1[0] === e2[1] && e1[1] === e2[0])
      || (e1[0] === e2[0] && e1[1] === e2[1])
}

/** Get the 3 edges of a triangle */
function triangleEdges(tri: Triangle): [Point, Point][] {
  return [
    [tri.p[0], tri.p[1]],
    [tri.p[1], tri.p[2]],
    [tri.p[2], tri.p[0]]
  ]
}

/**
 * Check if an edge is shared between a triangle and any other triangle in a list.
 * Shared edges are INTERIOR to the hole and should be discarded.
 * Non-shared edges form the BOUNDARY of the hole.
 */
function isSharedEdge(edge: [Point, Point], ownerTri: Triangle, allTris: Triangle[]): boolean {
  return allTris.some(other => {
    if (other === ownerTri) return false
    return triangleEdges(other).some(otherEdge => edgesMatch(edge, otherEdge))
  })
}

/**
 * Find the boundary edges of the polygonal hole left by removing triangles.
 * Only edges that belong to exactly ONE removed triangle are on the boundary.
 */
function findBoundaryEdges(removedTriangles: Triangle[]): [Point, Point][] {
  const boundary: [Point, Point][] = []

  for (const tri of removedTriangles) {
    for (const edge of triangleEdges(tri)) {
      if (!isSharedEdge(edge, tri, removedTriangles)) {
        boundary.push(edge)
      }
    }
  }

  return boundary
}

/**
 * Bowyer-Watson algorithm — builds a Delaunay triangulation incrementally.
 *
 * How it works:
 *  1. Create a huge "super-triangle" that encloses all input points
 *  2. Insert points one at a time:
 *     a. Find all triangles whose circumcircle contains the new point
 *        (these violate the Delaunay condition)
 *     b. Remove them, leaving a polygonal hole
 *     c. Connect each boundary edge of the hole to the new point
 *  3. Remove any triangles connected to the super-triangle vertices
 *
 * The result satisfies the Delaunay property: no point lies inside
 * the circumcircle of any triangle.
 */
export function bowyerWatson(points: Point[]): Triangle[] {
  if (points.length < 3) return []

  // Step 1: Create a super-triangle large enough to contain all points
  const minX = Math.min(...points.map(p => p.x)) - 100
  const maxX = Math.max(...points.map(p => p.x)) + 100
  const minY = Math.min(...points.map(p => p.y)) - 100
  const maxY = Math.max(...points.map(p => p.y)) + 100
  const padding = Math.max(maxX - minX, maxY - minY) * 2

  const superA: Point = { x: minX - padding, y: minY - 1, __super: true }
  const superB: Point = { x: minX + padding, y: minY - 1, __super: true }
  const superC: Point = { x: (minX + maxX) / 2, y: maxY + padding, __super: true }

  let triangles: Triangle[] = [{ p: [superA, superB, superC] }]

  // Step 2: Insert each point
  for (const point of points) {
    // 2a. Split triangles into ones that contain the point in their
    //     circumcircle (invalid) and ones that don't (still valid)
    const invalidated: Triangle[] = []
    const kept: Triangle[] = []

    for (const tri of triangles) {
      if (isInsideCircumcircle(point, tri)) {
        invalidated.push(tri)
      } else {
        kept.push(tri)
      }
    }

    // 2b. Find the boundary of the hole left by removing invalid triangles
    const boundary = findBoundaryEdges(invalidated)

    // 2c. Fill the hole by connecting each boundary edge to the new point
    triangles = kept
    for (const [edgeA, edgeB] of boundary) {
      triangles.push({ p: [edgeA, edgeB, point] })
    }
  }

  // Step 3: Remove scaffolding (triangles touching super-triangle vertices)
  return triangles.filter(tri => !tri.p.some(p => p.__super))
}
