/**
 * grid.ts — Grid setup and the five pipeline steps.
 *
 *   Step 1: Grid display + hole creation  (UI in App.vue)
 *   Step 2: Outer boundary detection      (k-NN concave hull)
 *   Step 3: Inner hole detection          (flood-fill empty cells + concave hull)
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

function getBoundaryRadius(angle: number, radii: number[]): number {
  let a = angle
  if (a < 0) a += Math.PI * 2
  const sector = (Math.PI * 2) / BOUNDARY_CONTROL_POINTS
  const idx = Math.floor(a / sector)
  const nextIdx = (idx + 1) % BOUNDARY_CONTROL_POINTS
  const t = (a - idx * sector) / sector
  return radii[idx] * (1 - t) + radii[nextIdx] * t
}

export function isInsideBoundary(col: number, row: number, radii: number[]): boolean {
  const dx = col - CENTER
  const dy = row - CENTER
  const dist = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx)
  return dist <= getBoundaryRadius(angle, radii)
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
    const angle = Math.atan2(dy, dx)

    const n = hole.numPoints
    const sector = (Math.PI * 2) / n
    let a = angle
    if (a < 0) a += Math.PI * 2

    const idx = Math.floor(a / sector)
    const nextIdx = (idx + 1) % n
    const t = (a - idx * sector) / sector
    const blobRadius = hole.radii[idx] * (1 - t) + hole.radii[nextIdx] * t

    if (dist <= blobRadius) return true
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
// Step 2: Detect outer boundary (k-NN concave hull)
// ═══════════════════════════════════════════════════════════════

export function detectOuterBoundary(points: Point[], k: number): Point[] {
  return concaveHull(points, k)
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Detect hole boundaries
// ═══════════════════════════════════════════════════════════════
//
// Algorithm:
//   1. Scan every grid cell inside the outer hull
//   2. Cells with no visible point are "empty"
//   3. Flood-fill connected empty cells into separate regions
//   4. Discard regions touching outside the hull (part of outer shape)
//   5. Compute concave hull of each region's empty cells
//   6. Collect empty cell positions for fill step

export function detectHoleBoundaries(
  visiblePoints: Point[],
  outerHull: Point[],
  k: number
): { hulls: Point[][]; emptyRegions: Point[][] } {
  const visibleSet = new Set(visiblePoints.map(p => `${p[0]},${p[1]}`))

  // Find bounding box of outer hull
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [hx, hy] of outerHull) {
    minX = Math.min(minX, hx)
    minY = Math.min(minY, hy)
    maxX = Math.max(maxX, hx)
    maxY = Math.max(maxY, hy)
  }

  // Classify cells inside the hull as occupied or empty
  const insideHull = new Set<string>()
  const empty = new Set<string>()
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      const key = `${x},${y}`
      if (!pointInPolygon([x, y], outerHull)) continue
      insideHull.add(key)
      if (!visibleSet.has(key)) empty.add(key)
    }
  }

  // Flood-fill empty cells into connected regions
  const DIRECTIONS: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]]
  const visited = new Set<string>()
  const hulls: Point[][] = []
  const emptyRegions: Point[][] = []

  for (const key of empty) {
    if (visited.has(key)) continue

    const region = new Set<string>()
    const stack = [key]
    let touchesOutside = false

    while (stack.length > 0) {
      const cur = stack.pop()!
      if (visited.has(cur) || !empty.has(cur)) continue
      visited.add(cur)
      region.add(cur)

      const [cx, cy] = cur.split(',').map(Number)
      for (const [dx, dy] of DIRECTIONS) {
        const neighbor = `${cx + dx},${cy + dy}`
        if (!insideHull.has(neighbor)) touchesOutside = true
        if (!visited.has(neighbor) && empty.has(neighbor)) stack.push(neighbor)
      }
    }

    // Only keep fully enclosed regions
    if (region.size < 2 || touchesOutside) continue

    // Convert to points
    const pts: Point[] = [...region].map(k => {
      const [x, y] = k.split(',').map(Number)
      return [x, y] as Point
    })

    // Compute concave hull for visualization
    const hull = concaveHull(pts, k)
    if (hull.length >= 3) {
      hulls.push(hull)
      emptyRegions.push(pts)
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
