/**
 * A 2D point represented as [x, y].
 */
export type Point = [number, number]

/**
 * An irregular blob-shaped hole defined by a center and variable radii.
 *
 * The shape is created by placing `numPoints` control points evenly spaced
 * around the center, each with its own radius. The boundary is linearly
 * interpolated between adjacent control points, producing an organic shape.
 */
export interface Hole {
  /** Center x position (in grid coordinates) */
  cx: number
  /** Center y position (in grid coordinates) */
  cy: number
  /** Radius at each control point around the center */
  radii: number[]
  /** Number of control points defining the blob shape */
  numPoints: number
}
