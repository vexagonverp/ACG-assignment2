/** A 2D point. __super marks temporary super-triangle vertices. */
export interface Point {
  x: number
  y: number
  __super?: boolean
}

/** A circle defined by its center and radius. */
export interface Circle {
  x: number
  y: number
  r: number
}

/** Pre-computed info about a triangle used for rendering and refinement. */
export interface TriangleInfo {
  p1: Point; p2: Point; p3: Point
  area: number
  angle: number        // smallest interior angle (degrees)
  cc: Circle | null    // circumscribed circle (null if degenerate)
  bigArea: boolean     // area exceeds threshold
  smallAngle: boolean  // min angle below threshold
  bad: boolean         // needs refinement (bigArea OR smallAngle)
}

/** Tolerance for floating-point comparisons */
export const EPSILON = 1e-10

/** Replace non-finite values with 0 to prevent SVG rendering crashes */
export function safe(v: number): number {
  return isFinite(v) ? v : 0
}

/** Clamp a value to the range [-1, 1] (needed before passing to Math.acos) */
function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/** Squared distance between two points */
function distanceSq(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

/** Distance between two points */
function distance(a: Point, b: Point): number {
  return Math.sqrt(distanceSq(a, b))
}

/** Midpoint of two points */
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

// ─── Line utilities (ax + by = c) ───────────────────────────────────

interface Line { a: number; b: number; c: number }

/** Derive line equation ax + by = c from two points */
function lineFromPoints(p1: Point, p2: Point): Line {
  const a = p2.y - p1.y
  const b = p1.x - p2.x
  const c = a * p1.x + b * p1.y
  return { a, b, c }
}

/**
 * Convert a line to its perpendicular bisector passing through a midpoint.
 * Perpendicular to ax + by = c is -bx + ay = d
 */
function perpendicularBisector(line: Line, mid: Point): Line {
  const a = -line.b
  const b = line.a
  const c = a * mid.x + b * mid.y
  return { a, b, c }
}

/** Find intersection of two lines. Returns null if parallel. */
function lineIntersection(l1: Line, l2: Line): Point | null {
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < EPSILON) return null // parallel lines = collinear points

  const x = (l2.b * l1.c - l1.b * l2.c) / det
  const y = (l1.a * l2.c - l2.a * l1.c) / det

  if (!isFinite(x) || !isFinite(y)) return null
  return { x, y }
}

// ─── Core geometry functions ────────────────────────────────────────

/**
 * Compute the circumscribed circle (circumcircle) of a triangle.
 *
 * The circumcenter is where the perpendicular bisectors of two edges meet.
 * That point is equidistant from all 3 vertices, so a circle centered
 * there passes through all of them.
 *
 * Steps:
 *  1. Get line equations for two edges
 *  2. Compute perpendicular bisector of each edge (through its midpoint)
 *  3. Find where the two bisectors intersect → that's the circumcenter
 *  4. Radius = distance from circumcenter to any vertex
 *
 * Returns null when points are collinear (bisectors are parallel).
 */
export function circumcircle(p1: Point, p2: Point, p3: Point): Circle | null {
  // Step 1: Line equations for edges p1→p2 and p2→p3
  const lineAB = lineFromPoints(p1, p2)
  const lineBC = lineFromPoints(p2, p3)

  // Step 2: Perpendicular bisectors through each edge's midpoint
  const midAB = midpoint(p1, p2)
  const midBC = midpoint(p2, p3)
  const bisectorAB = perpendicularBisector(lineAB, midAB)
  const bisectorBC = perpendicularBisector(lineBC, midBC)

  // Step 3: Circumcenter = intersection of the two bisectors
  const center = lineIntersection(bisectorAB, bisectorBC)
  if (!center) return null // collinear points

  // Step 4: Radius = distance from center to any vertex
  const radius = distance(center, p1)
  if (!isFinite(radius)) return null

  return { x: center.x, y: center.y, r: radius }
}

/**
 * Triangle area using the cross product formula.
 *
 * The cross product of vectors AB and AC gives a value whose
 * absolute value equals twice the triangle's area.
 *
 *   AB = (p2 - p1),  AC = (p3 - p1)
 *   cross = AB.x * AC.y - AC.x * AB.y
 *   area  = |cross| / 2
 */
export function triangleArea(p1: Point, p2: Point, p3: Point): number {
  const abX = p2.x - p1.x
  const abY = p2.y - p1.y
  const acX = p3.x - p1.x
  const acY = p3.y - p1.y

  const crossProduct = abX * acY - acX * abY
  const area = Math.abs(crossProduct) / 2

  return isFinite(area) ? area : 0
}

/**
 * Smallest interior angle of a triangle (in degrees).
 *
 * Uses the law of cosines to compute each angle:
 *   angle_A = acos( (b² + c² - a²) / (2bc) )
 *
 * where a is the side OPPOSITE vertex A, etc.
 */
export function minAngle(p1: Point, p2: Point, p3: Point): number {
  // Side lengths
  const sideA = distance(p2, p3)  // opposite p1
  const sideB = distance(p1, p3)  // opposite p2
  const sideC = distance(p1, p2)  // opposite p3

  // Degenerate triangle (zero-length edge)
  if (sideA < EPSILON || sideB < EPSILON || sideC < EPSILON) return 0

  // Squared side lengths (for the cosine formula numerator)
  const aSq = sideA ** 2
  const bSq = sideB ** 2
  const cSq = sideC ** 2

  // Angle at each vertex using law of cosines
  const cosAtP1 = (bSq + cSq - aSq) / (2 * sideB * sideC)
  const cosAtP2 = (aSq + cSq - bSq) / (2 * sideA * sideC)
  const cosAtP3 = (aSq + bSq - cSq) / (2 * sideA * sideB)

  const angleAtP1 = Math.acos(clamp(cosAtP1))
  const angleAtP2 = Math.acos(clamp(cosAtP2))
  const angleAtP3 = Math.acos(clamp(cosAtP3))

  // Convert smallest angle from radians to degrees
  const minRadians = Math.min(angleAtP1, angleAtP2, angleAtP3)
  const minDegrees = minRadians * (180 / Math.PI)

  return isFinite(minDegrees) ? minDegrees : 0
}

/**
 * Test if point (px, py) is inside triangle (p1, p2, p3).
 *
 * For each edge, compute the cross product with the vector to the test point.
 * If all three cross products have the same sign → point is inside.
 * Mixed signs → point is outside.
 */
export function pointInTriangle(px: number, py: number, p1: Point, p2: Point, p3: Point): boolean {
  const cross1 = (px - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (py - p2.y)
  const cross2 = (px - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (py - p3.y)
  const cross3 = (px - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (py - p1.y)

  const hasNegative = (cross1 < -EPSILON) || (cross2 < -EPSILON) || (cross3 < -EPSILON)
  const hasPositive = (cross1 > EPSILON) || (cross2 > EPSILON) || (cross3 > EPSILON)

  // Inside only if all cross products have the same sign
  return !(hasNegative && hasPositive)
}
