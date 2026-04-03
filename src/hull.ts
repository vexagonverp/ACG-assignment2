import { polygonHull, polygonContains } from 'd3-polygon'
import type { Point } from './geometry'

export function convexHull(points: Point[]): Point[] {
  const coords: [number, number][] = points.map(p => [p.x, p.y])
  const hull = polygonHull(coords)
  if (!hull) return points.slice(0, 3)
  return hull.map(([x, y]) => ({ x, y }))
}

export function pointInConvexHull(point: Point, hull: Point[]): boolean {
  if (hull.length < 3) return true
  const polygon: [number, number][] = hull.map(p => [p.x, p.y])
  return polygonContains(polygon, [point.x, point.y])
}
