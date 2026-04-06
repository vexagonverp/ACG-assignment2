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

// ═══════════════════════════════════════════════════════════════
// Outer boundary shape
// ═══════════════════════════════════════════════════════════════

const BOUNDARY_CONTROL_POINTS = 16

export function generateBoundaryRadii(): number[] {
  const radii: number[] = []
  for (let i = 0; i < BOUNDARY_CONTROL_POINTS; i++) {
    radii.push(CENTER * (0.7 + Math.random() * 0.3))
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

export function createHole(cx: number, cy: number): Hole {
  const baseRadius = 2 + Math.random() * 3
  const numPoints = 8 + Math.floor(Math.random() * 5)
  const radii: number[] = []
  for (let j = 0; j < numPoints; j++) {
    radii.push(baseRadius * (0.5 + Math.random() * 0.8))
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
  return !occupied.has(`${x},${y - 1}`) ||
         !occupied.has(`${x + 1},${y}`) ||
         !occupied.has(`${x},${y + 1}`) ||
         !occupied.has(`${x - 1},${y}`)
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

  const occupied = new Set(points.map(p => `${p[0]},${p[1]}`))

  // 1. Find topmost-leftmost occupied cell
  let start = points[0]
  for (const p of points) {
    if (p[1] < start[1] || (p[1] === start[1] && p[0] < start[0])) {
      start = p
    }
  }

  const boundary: Point[] = [start]
  const visited = new Set([`${start[0]},${start[1]}`])

  let px = start[0], py = start[1]

  // Initial direction (p → pPrev): pretend we came from the west
  let backAngle = Math.PI

  for (let iter = 0; iter < points.length * 2; iter++) {
    // Try each ring distance 1, 2, ..., k in order.
    // At each distance, sort boundary-eligible cells CW from backAngle.
    // Only move to a larger ring if no unvisited candidates at the current ring.
    // This ensures the walk follows the boundary tightly at distance 1,
    // and only "jumps" to distance 2+ to cross gaps (smoother boundary).
    let foundNext: Point | null = null

    for (let ring = 1; ring <= k && !foundNext; ring++) {
      const candidates: { x: number; y: number; turn: number }[] = []

      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue

          const nx = px + dx, ny = py + dy
          if (!occupied.has(`${nx},${ny}`)) continue
          if (!hasEmpty4Neighbor(nx, ny, occupied)) continue

          const angle = Math.atan2(dy, dx)
          let turn = angle - backAngle
          while (turn < 0) turn += Math.PI * 2
          while (turn >= Math.PI * 2) turn -= Math.PI * 2

          candidates.push({ x: nx, y: ny, turn })
        }
      }

      candidates.sort((a, b) => a.turn - b.turn)

      for (const cand of candidates) {
        if (cand.x === start[0] && cand.y === start[1] && boundary.length >= 3) {
          return boundary
        }
        if (!visited.has(`${cand.x},${cand.y}`)) {
          foundNext = [cand.x, cand.y]
          break
        }
      }
    }

    if (!foundNext) break

    backAngle = Math.atan2(py - foundNext[1], px - foundNext[0])
    px = foundNext[0]
    py = foundNext[1]
    boundary.push(foundNext)
    visited.add(`${px},${py}`)
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

export function detectHoleBoundaries(
  visiblePoints: Point[],
  outerBoundary: Point[],
  k: number
): { hulls: Point[][]; emptyRegions: Point[][] } {
  const occupied = new Set(visiblePoints.map(p => `${p[0]},${p[1]}`))
  const exteriorSet = new Set(outerBoundary.map(p => `${p[0]},${p[1]}`))

  // 1. Find all hole boundary points — O(N)
  const holeBoundarySet = new Set<string>()
  const holeBoundaryPoints: Point[] = []

  for (const pt of visiblePoints) {
    const key = `${pt[0]},${pt[1]}`
    if (exteriorSet.has(key)) continue
    if (hasEmpty4Neighbor(pt[0], pt[1], occupied)) {
      holeBoundarySet.add(key)
      holeBoundaryPoints.push(pt)
    }
  }

  // 2. Cluster by 8-connectivity
  const NEIGHBORS_8: [number, number][] = [
    [1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]
  ]
  const visited = new Set<string>()
  const hulls: Point[][] = []
  const emptyRegions: Point[][] = []

  for (const pt of holeBoundaryPoints) {
    const key = `${pt[0]},${pt[1]}`
    if (visited.has(key)) continue

    // Flood-fill this cluster
    const cluster: Point[] = []
    const stack: Point[] = [pt]

    while (stack.length > 0) {
      const cur = stack.pop()!
      const ck = `${cur[0]},${cur[1]}`
      if (visited.has(ck)) continue
      visited.add(ck)
      cluster.push(cur)

      for (const [dx, dy] of NEIGHBORS_8) {
        const nk = `${cur[0] + dx},${cur[1] + dy}`
        if (!visited.has(nk) && holeBoundarySet.has(nk)) {
          stack.push([cur[0] + dx, cur[1] + dy])
        }
      }
    }

    if (cluster.length < 3) continue

    // 3. Flood-fill ALL empty cells inside this hole
    //    Start from empty cells adjacent to boundary points,
    //    then expand inward to capture the full hole interior.
    const emptyFound = new Set<string>()
    const emptyPts: Point[] = []
    const emptyStack: string[] = []
    const DIRS_4: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]]

    // Seed: empty cells adjacent to the boundary cluster
    for (const cp of cluster) {
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = cp[0] + dx, ny = cp[1] + dy
        const nk = `${nx},${ny}`
        if (!occupied.has(nk) && !emptyFound.has(nk)) {
          emptyFound.add(nk)
          emptyStack.push(nk)
        }
      }
    }

    // Expand: flood-fill connected empty cells
    while (emptyStack.length > 0) {
      const ek = emptyStack.pop()!
      const [ex, ey] = ek.split(',').map(Number)
      emptyPts.push([ex, ey])

      for (const [dx, dy] of DIRS_4) {
        const nk = `${ex + dx},${ey + dy}`
        if (!occupied.has(nk) && !emptyFound.has(nk)) {
          emptyFound.add(nk)
          emptyStack.push(nk)
        }
      }
    }

    // 4. Compute concave hull of the empty cells for visualization
    const hullPts = emptyPts.length >= 3 ? emptyPts : cluster
    const hull = concaveHull(hullPts, k)
    if (hull.length >= 3) {
      hulls.push(hull)
      emptyRegions.push(emptyPts)
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
  const existing = new Set(existingPoints.map(p => `${p[0]},${p[1]}`))
  const newPoints: Point[] = []

  for (const region of emptyRegions) {
    for (const pt of region) {
      const key = `${pt[0]},${pt[1]}`
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

  const samples: Point[] = [
    [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3],
    [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2],
    [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
    [(p2[0] + p0[0]) / 2, (p2[1] + p0[1]) / 2],
  ]

  for (const sp of samples) {
    if (!pointInPolygon(sp, hull)) return false
  }
  return true
}
