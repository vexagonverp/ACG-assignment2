/**
 * grid.ts — Grid setup and the five pipeline steps.
 *
 *   Step 1: Grid display + hole creation  (UI in App.vue)
 *   Step 2: Outer boundary detection      (BoundaryExterior: k-ring clockwise walk)
 *   Step 3: Inner hole detection          (BoundaryHole: O(N) 4-neighbor check)
 *   Step 4: Fill hole regions             (insert exact empty cell positions)
 *   Step 5: Delaunay triangulation        (d3-delaunay + boundary filtering)
 */

import type { Point, Hole } from './types'
import { concaveHull, pointInPolygon } from './geometry'
import { Delaunay } from 'd3-delaunay'

// ═══════════════════════════════════════════════════════════════
// Grid configuration
// ═══════════════════════════════════════════════════════════════

export const CANVAS_GRID_SIZE = 70
export const FILL_GRID_SIZE = 50
export const SPACING = 11
export const POINT_RADIUS = 2
export const CANVAS_SIZE = (CANVAS_GRID_SIZE + 1) * SPACING
export const OFFSET = Math.floor((CANVAS_GRID_SIZE - FILL_GRID_SIZE) / 2)

const CENTER = FILL_GRID_SIZE / 2

/** Encodes a grid cell (x, y) into a unique string key for Set/Map lookups. */
function gridKey(x: number, y: number): string {
  return `${x},${y}`
}

// ═══════════════════════════════════════════════════════════════
// Outer boundary shape
// ═══════════════════════════════════════════════════════════════

const BOUNDARY_CONTROL_POINTS = 16
const BOUNDARY_MIN_SCALE = 0.7   // minimum radius as fraction of CENTER
const BOUNDARY_RANDOM_SCALE = 0.3 // additional random radius fraction

export function generateBoundaryRadii(): number[] {
  const radii: number[] = []
  for (let i = 0; i < BOUNDARY_CONTROL_POINTS; i++) {
    radii.push(CENTER * (BOUNDARY_MIN_SCALE + Math.random() * BOUNDARY_RANDOM_SCALE))
  }
  return radii
}

/**
 * Interpolates radius at a given angle from evenly-spaced control radii.
 * Shared by both outer boundary and hole blob shapes.
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

export function isInsideBoundary(col: number, row: number, radii: number[]): boolean {
  const dx = col - CENTER
  const dy = row - CENTER
  const dist = Math.sqrt(dx * dx + dy * dy)
  return dist <= interpolateRadius(Math.atan2(dy, dx), radii)
}

// ═══════════════════════════════════════════════════════════════
// Hole creation (Step 1)
// ═══════════════════════════════════════════════════════════════

const MIN_HOLE_RADIUS = 2
const MAX_HOLE_RADIUS_EXTRA = 3    // baseRadius ∈ [2, 5]
const MIN_HOLE_CONTROL_POINTS = 8
const MAX_HOLE_CONTROL_EXTRA = 5   // numPoints ∈ [8, 12]
const HOLE_RADII_MIN_SCALE = 0.5   // per-point radius variation
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

export function isInHole(col: number, row: number, holes: Hole[]): boolean {
  for (const hole of holes) {
    const dx = col - hole.cx
    const dy = row - hole.cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= interpolateRadius(Math.atan2(dy, dx), hole.radii)) return true
  }
  return false
}

// ═══════════════════════════════════════════════════════════════
// Visible points
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Shared helper
// ═══════════════════════════════════════════════════════════════

/** True if any of the 4 cardinal neighbors of (x,y) is not in the occupied set. */
function hasEmpty4Neighbor(x: number, y: number, occupied: Set<string>): boolean {
  return !occupied.has(gridKey(x, y - 1)) ||
         !occupied.has(gridKey(x + 1, y)) ||
         !occupied.has(gridKey(x, y + 1)) ||
         !occupied.has(gridKey(x - 1, y))
}

// ═══════════════════════════════════════════════════════════════
// Step 2: BoundaryExterior (k-ring clockwise walk)
// ═══════════════════════════════════════════════════════════════
//
// Algorithm:
//   1. Find pFirst = topmost-leftmost occupied cell
//   2. Grow clockwise:
//      - Enumerate RNk(p) clockwise starting from direction (p → pPrev)
//      - For each candidate q, check intermediate points qi on segment
//        (p, q) at each ring distance i = 1..k
//      - If qi is occupied AND any 4-neighbor of qi is empty → pNext = qi
//   3. Stop when p returns to pFirst
//   4. Falls back to concave hull if the walk doesn't close
//
// k controls smoothness: higher k = smoother, may skip small features.

export function detectOuterBoundary(points: Point[], k: number): Point[] {
  if (points.length < 3) return points

  const occupied = new Set(points.map(p => gridKey(p[0], p[1])))

  // 1. Find topmost-leftmost occupied cell
  let start = points[0]
  for (const p of points) {
    if (p[1] < start[1] || (p[1] === start[1] && p[0] < start[0])) {
      start = p
    }
  }

  const boundary: Point[] = [start]
  const visited = new Set([gridKey(start[0], start[1])])

  let currentX = start[0], currentY = start[1]

  // Initial direction (current → previous): pretend we came from the west
  let backAngle = Math.PI

  for (let iter = 0; iter < points.length * 2; iter++) {
    // Try each ring distance 1, 2, ..., k in order.
    // At each distance, sort boundary-eligible cells CW from backAngle.
    // Only move to a larger ring if no unvisited candidates at the current ring.
    // This ensures the walk follows the boundary tightly at distance 1,
    // and only "jumps" to distance 2+ to cross gaps (smoother boundary).
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
          let turn = angle - backAngle
          while (turn < 0) turn += Math.PI * 2
          while (turn >= Math.PI * 2) turn -= Math.PI * 2

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

  // Fallback: if walk didn't close, use concave hull
  if (boundary.length < 3) return concaveHull(points, k)
  return boundary
}

// ═══════════════════════════════════════════════════════════════
// Step 3: BoundaryHole (O(N) 4-neighbor check)
// ═══════════════════════════════════════════════════════════════
//
// Algorithm:
//   1. Mark all exterior boundary points from Step 2
//   2. For every occupied cell pi:
//      - If NOT an exterior boundary point
//      - AND at least one 4-neighbor is empty
//      → pi is a hole boundary point
//   3. Cluster hole boundary points by 8-connectivity → one group per hole
//   4. For each group, collect adjacent empty cells (for fill step)
//   5. Compute concave hull of each group (for visualization)

const NEIGHBORS_8: [number, number][] = [
  [1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]
]
const NEIGHBORS_4: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]]

/**
 * Flood-fills from the grid edges inward to find all empty cells that
 * belong to the exterior (outside the point cloud). Any empty cell NOT
 * in this set must be inside a hole.
 */
function findExteriorEmptyCells(occupied: Set<string>): Set<string> {
  const exterior = new Set<string>()
  const stack: Point[] = []
  const minB = OFFSET, maxB = OFFSET + FILL_GRID_SIZE - 1

  // Seed: all empty cells on the 4 grid edges
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
 * Finds all interior points that border an empty hole cell.
 * A point qualifies if at least one of its 4-neighbors is an empty cell
 * that is NOT part of the exterior (i.e. it's inside a hole).
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
    // Check if any 4-neighbor is empty AND not exterior → borders a hole
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

/**
 * Groups hole boundary points into clusters using 8-connectivity BFS.
 * Each cluster corresponds to one distinct hole in the point cloud.
 */
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
 * Flood-fills all empty cells reachable from a hole boundary cluster,
 * excluding any cell that belongs to the exterior.
 * Seeds from empty 8-neighbors of boundary points, then expands
 * through 4-connected empty cells to capture the full hole interior.
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

  // Seed: empty non-exterior cells adjacent (8-connected) to boundary points
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

  // Expand: flood-fill through 4-connected non-exterior empty cells
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

export function detectHoleBoundaries(
  visiblePoints: Point[],
  k: number
): { hulls: Point[][]; emptyRegions: Point[][] } {
  const occupied = new Set(visiblePoints.map(p => gridKey(p[0], p[1])))

  // 1. Flood-fill from grid edges to identify all exterior empty cells
  const exteriorEmpty = findExteriorEmptyCells(occupied)

  // 2. Find interior points that border a non-exterior empty cell — O(N)
  const holeBoundary = findHoleBoundaryPoints(visiblePoints, occupied, exteriorEmpty)

  // 3. Group boundary points into per-hole clusters by 8-connectivity
  const clusters = clusterByConnectivity(holeBoundary.points, holeBoundary.keys)

  // 4. For each cluster, flood-fill its empty interior and compute a hull
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

// ═══════════════════════════════════════════════════════════════
// Step 4: Fill hole regions
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Step 5: Delaunay triangulation
// ═══════════════════════════════════════════════════════════════

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

function isTriangleInsideHull(
  p0: Point, p1: Point, p2: Point,
  hull: Point[]
): boolean {
  if (hull.length < 3) return true

  // Sample the centroid and 3 edge midpoints — if all are inside the hull,
  // the triangle is considered interior (filters out triangles spanning outside)
  const centroid: Point = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3]
  const midEdge01: Point = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
  const midEdge12: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
  const midEdge20: Point = [(p2[0] + p0[0]) / 2, (p2[1] + p0[1]) / 2]

  for (const sample of [centroid, midEdge01, midEdge12, midEdge20]) {
    if (!pointInPolygon(sample, hull)) return false
  }
  return true
}
