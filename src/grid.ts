/**
 * grid.ts
 *
 * Grid setup and the five pipeline steps for point cloud processing:
 *
 *   1. Grid display + hole creation  (UI in App.vue)
 *   2. Outer boundary detection      (k-ring clockwise walk)
 *   3. Inner hole detection           (4-neighbor check, O(N))
 *   4. Fill hole regions              (insert empty cell positions)
 *   5. Delaunay triangulation         (d3-delaunay, filtered by hull)
 */

import type { Point, Hole } from './types'
import { concaveHull, pointInPolygon, normalizeAngle, findTopLeft } from './geometry'
import { Delaunay } from 'd3-delaunay'

// ── Grid configuration ─────────────────────────────────────

export const CANVAS_GRID_SIZE = 70
export const FILL_GRID_SIZE = 50
export const SPACING = 11
export const POINT_RADIUS = 2
export const CANVAS_SIZE = (CANVAS_GRID_SIZE + 1) * SPACING
export const OFFSET = Math.floor((CANVAS_GRID_SIZE - FILL_GRID_SIZE) / 2)

const CENTER = FILL_GRID_SIZE / 2

/** Turns (x, y) into a string like "12,7" for use as Set/Map keys. */
function gridKey(x: number, y: number): string {
  return `${x},${y}`
}

// ── Outer boundary shape ───────────────────────────────────
//
// The outer boundary is an irregular blob defined by control radii at
// evenly-spaced angles around the grid center. Each radius is randomly
// scaled between BOUNDARY_MIN_SCALE and (MIN + RANDOM) of CENTER, so
// the shape looks organic rather than circular.

const BOUNDARY_CONTROL_POINTS = 16
const BOUNDARY_MIN_SCALE = 0.7
const BOUNDARY_RANDOM_SCALE = 0.3

export function generateBoundaryRadii(): number[] {
  const radii: number[] = []
  for (let i = 0; i < BOUNDARY_CONTROL_POINTS; i++) {
    radii.push(CENTER * (BOUNDARY_MIN_SCALE + Math.random() * BOUNDARY_RANDOM_SCALE))
  }
  return radii
}

/**
 * Given an angle, linearly interpolates between two adjacent control radii
 * to get the boundary distance at that angle. Both the outer boundary and
 * hole blobs use this same interpolation.
 */
function interpolateRadius(angle: number, radii: number[]): number {
  let a = angle
  if (a < 0) a += Math.PI * 2
  const n = radii.length
  const sector = (Math.PI * 2) / n
  const idx = Math.floor(a / sector)
  const nextIdx = (idx + 1) % n
  const t = (a - idx * sector) / sector
  return radii[idx] * (1 - t) + radii[nextIdx] * t
}

/** True when (col, row) falls inside the outer boundary blob. */
export function isInsideBoundary(col: number, row: number, radii: number[]): boolean {
  const dx = col - CENTER
  const dy = row - CENTER
  const dist = Math.sqrt(dx * dx + dy * dy)
  return dist <= interpolateRadius(Math.atan2(dy, dx), radii)
}

// ── Hole creation (Step 1) ─────────────────────────────────
//
// Holes are smaller blobs placed inside the boundary. Each hole has its
// own random center, base radius, and per-angle radii, so the shapes
// are irregular rather than circular.

const MIN_HOLE_RADIUS = 2
const MAX_HOLE_RADIUS_EXTRA = 3
const MIN_HOLE_CONTROL_POINTS = 8
const MAX_HOLE_CONTROL_EXTRA = 5
const HOLE_RADII_MIN_SCALE = 0.5
const HOLE_RADII_RANDOM_SCALE = 0.8

export function createHole(cx: number, cy: number): Hole {
  const baseRadius = MIN_HOLE_RADIUS + Math.random() * MAX_HOLE_RADIUS_EXTRA
  const numPoints = MIN_HOLE_CONTROL_POINTS + Math.floor(Math.random() * MAX_HOLE_CONTROL_EXTRA)
  const radii: number[] = []
  for (let j = 0; j < numPoints; j++) {
    radii.push(baseRadius * (HOLE_RADII_MIN_SCALE + Math.random() * HOLE_RADII_RANDOM_SCALE))
  }
  return { cx, cy, radii, numPoints }
}

/** True when (col, row) falls inside any of the holes. */
export function isInHole(col: number, row: number, holes: Hole[]): boolean {
  for (const hole of holes) {
    const dx = col - hole.cx
    const dy = row - hole.cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= interpolateRadius(Math.atan2(dy, dx), hole.radii)) return true
  }
  return false
}

// ── Visible points ─────────────────────────────────────────

/** Collects all grid cells that are inside the boundary but not inside any hole. */
export function getVisiblePoints(
  boundaryRadii: number[],
  holes: Hole[]
): Point[] {
  const pts: Point[] = []
  for (let row = 0; row < FILL_GRID_SIZE; row++) {
    for (let col = 0; col < FILL_GRID_SIZE; col++) {
      if (!isInsideBoundary(col, row, boundaryRadii)) continue
      const gCol = col + OFFSET
      const gRow = row + OFFSET
      if (isInHole(gCol, gRow, holes)) continue
      pts.push([gCol, gRow])
    }
  }
  return pts
}

// ── Shared helper ──────────────────────────────────────────

/** True when at least one of the 4 cardinal neighbors of (x,y) is missing from the set. */
function hasEmpty4Neighbor(x: number, y: number, occupied: Set<string>): boolean {
  return !occupied.has(gridKey(x, y - 1)) ||
         !occupied.has(gridKey(x + 1, y)) ||
         !occupied.has(gridKey(x, y + 1)) ||
         !occupied.has(gridKey(x - 1, y))
}

// ── Step 2: outer boundary detection (k-ring clockwise walk) ──
//
// Starting from the top-left occupied cell, the algorithm walks clockwise
// along cells that sit on the edge (have at least one empty 4-neighbor).
// At each step it checks rings of distance 1..k around the current cell,
// preferring closer rings so the walk stays tight. It only jumps to a
// larger ring when no unvisited boundary cell exists at the current one.
//
// Higher k produces smoother boundaries but may skip small features.
// If the walk fails to close, it falls back to concave hull.

export function detectOuterBoundary(points: Point[], k: number): Point[] {
  if (points.length < 3) return points

  const occupied = new Set(points.map(p => gridKey(p[0], p[1])))

  const { point: start } = findTopLeft(points)

  const boundary: Point[] = [start]
  const visited = new Set([gridKey(start[0], start[1])])

  let currentX = start[0], currentY = start[1]

  // Pretend we arrived from the west so the first scan goes clockwise
  let backAngle = Math.PI

  for (let iter = 0; iter < points.length * 2; iter++) {
    let nextPoint: Point | null = null

    for (let ring = 1; ring <= k && !nextPoint; ring++) {
      const candidates: { x: number; y: number; turn: number }[] = []

      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue

          const neighborX = currentX + dx, neighborY = currentY + dy
          if (!occupied.has(gridKey(neighborX, neighborY))) continue
          if (!hasEmpty4Neighbor(neighborX, neighborY, occupied)) continue

          const angle = Math.atan2(dy, dx)
          const turn = normalizeAngle(angle - backAngle)

          candidates.push({ x: neighborX, y: neighborY, turn })
        }
      }

      candidates.sort((a, b) => a.turn - b.turn)

      for (const cand of candidates) {
        if (cand.x === start[0] && cand.y === start[1] && boundary.length >= 3) {
          return boundary
        }
        if (!visited.has(gridKey(cand.x, cand.y))) {
          nextPoint = [cand.x, cand.y]
          break
        }
      }
    }

    if (!nextPoint) break

    backAngle = Math.atan2(currentY - nextPoint[1], currentX - nextPoint[0])
    currentX = nextPoint[0]
    currentY = nextPoint[1]
    boundary.push(nextPoint)
    visited.add(gridKey(currentX, currentY))
  }

  if (boundary.length < 3) return concaveHull(points, k)
  return boundary
}

// ── Step 3: hole boundary detection ────────────────────────
//
// To find hole boundaries we first need to distinguish "exterior" empty
// cells (outside the point cloud) from "interior" ones (inside a hole).
// A flood-fill from the grid edges marks all exterior empties; any empty
// cell not reached by that fill must be inside a hole.
//
// From there, any occupied cell that has a non-exterior empty neighbor
// is on a hole boundary. Those boundary cells get grouped by
// 8-connectivity into per-hole clusters, and each cluster gets a
// concave hull for visualization.

const NEIGHBORS_8: [number, number][] = [
  [1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]
]
const NEIGHBORS_4: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]]

/**
 * Flood-fills from the grid edges inward through empty cells.
 * Everything reached is "exterior"; unreached empties are inside holes.
 */
function findExteriorEmptyCells(occupied: Set<string>): Set<string> {
  const exterior = new Set<string>()
  const stack: Point[] = []
  const minB = OFFSET, maxB = OFFSET + FILL_GRID_SIZE - 1

  // Seed with empty cells on the four grid edges
  for (let x = minB; x <= maxB; x++) {
    for (const y of [minB, maxB]) {
      const key = gridKey(x, y)
      if (!occupied.has(key) && !exterior.has(key)) { exterior.add(key); stack.push([x, y]) }
    }
  }
  for (let y = minB + 1; y < maxB; y++) {
    for (const x of [minB, maxB]) {
      const key = gridKey(x, y)
      if (!occupied.has(key) && !exterior.has(key)) { exterior.add(key); stack.push([x, y]) }
    }
  }

  // Expand inward through 4-connected empty cells
  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = cx + dx, ny = cy + dy
      if (nx < minB || nx > maxB || ny < minB || ny > maxB) continue
      const key = gridKey(nx, ny)
      if (!occupied.has(key) && !exterior.has(key)) {
        exterior.add(key)
        stack.push([nx, ny])
      }
    }
  }

  return exterior
}

/**
 * An occupied cell is a hole boundary cell when at least one of its
 * 4-neighbors is empty and that empty cell is not part of the exterior.
 */
function findHoleBoundaryPoints(
  visiblePoints: Point[],
  occupied: Set<string>,
  exteriorEmpty: Set<string>
): { points: Point[]; keys: Set<string> } {
  const keys = new Set<string>()
  const points: Point[] = []

  for (const pt of visiblePoints) {
    const key = gridKey(pt[0], pt[1])
    let bordersHole = false
    for (const [dx, dy] of NEIGHBORS_4) {
      const neighborKey = gridKey(pt[0] + dx, pt[1] + dy)
      if (!occupied.has(neighborKey) && !exteriorEmpty.has(neighborKey)) {
        bordersHole = true
        break
      }
    }
    if (bordersHole) {
      keys.add(key)
      points.push(pt)
    }
  }

  return { points, keys }
}

/** Groups hole boundary cells into clusters via 8-connectivity BFS. */
function clusterByConnectivity(
  holeBoundaryPoints: Point[],
  holeBoundaryKeys: Set<string>
): Point[][] {
  const visited = new Set<string>()
  const clusters: Point[][] = []

  for (const pt of holeBoundaryPoints) {
    const key = gridKey(pt[0], pt[1])
    if (visited.has(key)) continue

    const cluster: Point[] = []
    const stack: Point[] = [pt]

    while (stack.length > 0) {
      const current = stack.pop()!
      const currentKey = gridKey(current[0], current[1])
      if (visited.has(currentKey)) continue
      visited.add(currentKey)
      cluster.push(current)

      for (const [dx, dy] of NEIGHBORS_8) {
        const neighborKey = gridKey(current[0] + dx, current[1] + dy)
        if (!visited.has(neighborKey) && holeBoundaryKeys.has(neighborKey)) {
          stack.push([current[0] + dx, current[1] + dy])
        }
      }
    }

    if (cluster.length >= 3) clusters.push(cluster)
  }

  return clusters
}

/**
 * Starting from the 8-neighbors of a boundary cluster, flood-fills
 * through 4-connected empty cells that are not part of the exterior.
 * This captures the full interior of one hole.
 */
function floodFillEmptyRegion(
  cluster: Point[],
  occupied: Set<string>,
  exteriorEmpty: Set<string>
): Point[] {
  const minBound = OFFSET
  const maxBound = OFFSET + FILL_GRID_SIZE - 1

  const visited = new Set<string>()
  const emptyPoints: Point[] = []
  const stack: Point[] = []

  // Seed from empty non-exterior 8-neighbors of the boundary cluster
  for (const boundaryPoint of cluster) {
    for (const [dx, dy] of NEIGHBORS_8) {
      const neighborX = boundaryPoint[0] + dx, neighborY = boundaryPoint[1] + dy
      if (neighborX < minBound || neighborX > maxBound ||
          neighborY < minBound || neighborY > maxBound) continue
      const neighborKey = gridKey(neighborX, neighborY)
      if (!occupied.has(neighborKey) && !exteriorEmpty.has(neighborKey) && !visited.has(neighborKey)) {
        visited.add(neighborKey)
        stack.push([neighborX, neighborY])
      }
    }
  }

  // Expand through 4-connected non-exterior empties
  while (stack.length > 0) {
    const [emptyX, emptyY] = stack.pop()!
    emptyPoints.push([emptyX, emptyY])

    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = emptyX + dx, ny = emptyY + dy
      if (nx < minBound || nx > maxBound || ny < minBound || ny > maxBound) continue
      const neighborKey = gridKey(nx, ny)
      if (!occupied.has(neighborKey) && !exteriorEmpty.has(neighborKey) && !visited.has(neighborKey)) {
        visited.add(neighborKey)
        stack.push([nx, ny])
      }
    }
  }

  return emptyPoints
}

/**
 * Runs the full hole detection pipeline: flood-fill exterior, find
 * boundary cells, cluster them, then flood-fill each hole interior
 * and compute a concave hull per cluster.
 */
export function detectHoleBoundaries(
  visiblePoints: Point[],
  k: number
): { hulls: Point[][]; emptyRegions: Point[][] } {
  const occupied = new Set(visiblePoints.map(p => gridKey(p[0], p[1])))

  const exteriorEmpty = findExteriorEmptyCells(occupied)
  const holeBoundary = findHoleBoundaryPoints(visiblePoints, occupied, exteriorEmpty)
  const clusters = clusterByConnectivity(holeBoundary.points, holeBoundary.keys)

  const hulls: Point[][] = []
  const emptyRegions: Point[][] = []

  for (const cluster of clusters) {
    const emptyPoints = floodFillEmptyRegion(cluster, occupied, exteriorEmpty)
    const hullInput = emptyPoints.length >= 3 ? emptyPoints : cluster
    const hull = concaveHull(hullInput, k)
    if (hull.length >= 3) {
      hulls.push(hull)
      emptyRegions.push(emptyPoints)
    }
  }

  return { hulls, emptyRegions }
}

// ── Step 4: fill hole regions ──────────────────────────────

/** Returns new points that fill in the empty cells of each hole region, skipping duplicates. */
export function fillHolePoints(
  emptyRegions: Point[][],
  existingPoints: Point[]
): Point[] {
  const existing = new Set(existingPoints.map(p => gridKey(p[0], p[1])))
  const newPoints: Point[] = []

  for (const region of emptyRegions) {
    for (const pt of region) {
      const key = gridKey(pt[0], pt[1])
      if (existing.has(key)) continue
      newPoints.push(pt)
      existing.add(key)
    }
  }

  return newPoints
}

// ── Step 5: Delaunay triangulation ─────────────────────────

/**
 * Runs Delaunay triangulation on all points, then filters out any triangle
 * whose centroid or edge midpoints fall outside the outer hull. Without
 * this filter, d3-delaunay would produce long thin triangles that span
 * across concavities.
 */
export function triangulatePoints(
  allPoints: Point[],
  outerHull: Point[]
): [Point, Point, Point][] {
  if (allPoints.length < 3) return []

  const coords = new Float64Array(allPoints.length * 2)
  for (let i = 0; i < allPoints.length; i++) {
    coords[i * 2] = allPoints[i][0]
    coords[i * 2 + 1] = allPoints[i][1]
  }

  const delaunay = new Delaunay(coords)
  const triangles: [Point, Point, Point][] = []

  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const p0 = allPoints[delaunay.triangles[i]]
    const p1 = allPoints[delaunay.triangles[i + 1]]
    const p2 = allPoints[delaunay.triangles[i + 2]]

    if (isTriangleInsideHull(p0, p1, p2, outerHull)) {
      triangles.push([p0, p1, p2])
    }
  }

  return triangles
}

/**
 * Samples the centroid and three edge midpoints; if all four are inside
 * the hull polygon, the triangle is considered interior.
 */
function isTriangleInsideHull(
  p0: Point, p1: Point, p2: Point,
  hull: Point[]
): boolean {
  if (hull.length < 3) return true

  const centroid: Point = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3]
  const midEdge01: Point = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
  const midEdge12: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
  const midEdge20: Point = [(p2[0] + p0[0]) / 2, (p2[1] + p0[1]) / 2]

  for (const sample of [centroid, midEdge01, midEdge12, midEdge20]) {
    if (!pointInPolygon(sample, hull)) return false
  }
  return true
}
