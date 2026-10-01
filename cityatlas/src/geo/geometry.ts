import type { WorldBounds, WorldPoint } from './projection/mercator'

export function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function pointInPolygon(p: WorldPoint, ring: ReadonlyArray<WorldPoint>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function polygonArea(ring: ReadonlyArray<WorldPoint>): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y)
  return Math.abs(a / 2)
}

export function polygonCentroid(ring: ReadonlyArray<WorldPoint>): WorldPoint {
  let x = 0, y = 0
  for (const p of ring) { x += p.x; y += p.y }
  return { x: x / ring.length, y: y / ring.length }
}

export function boundsOf(points: ReadonlyArray<WorldPoint>): WorldBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function expandBounds(b: WorldBounds, pad: number): WorldBounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

/** Distance from point to segment and the parameter t of the closest point. */
export function pointToSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint): { d: number; t: number; point: WorldPoint } {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const point = { x: a.x + t * dx, y: a.y + t * dy }
  return { d: distance(p, point), t, point }
}

export function pointToPolyline(p: WorldPoint, line: ReadonlyArray<WorldPoint>): number {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, pointToSegment(p, line[i], line[i + 1]).d)
  return best
}

export function polylineLength(line: ReadonlyArray<WorldPoint>): number {
  let l = 0
  for (let i = 0; i < line.length - 1; i++) l += distance(line[i], line[i + 1])
  return l
}

/** Point at fraction t (0..1) along a polyline. */
export function pointAlong(line: ReadonlyArray<WorldPoint>, t: number): WorldPoint {
  if (line.length === 1) return line[0]
  const total = polylineLength(line)
  let target = Math.max(0, Math.min(1, t)) * total
  for (let i = 0; i < line.length - 1; i++) {
    const seg = distance(line[i], line[i + 1])
    if (target <= seg || i === line.length - 2) {
      const f = seg === 0 ? 0 : target / seg
      return { x: line[i].x + (line[i + 1].x - line[i].x) * f, y: line[i].y + (line[i + 1].y - line[i].y) * f }
    }
    target -= seg
  }
  return line[line.length - 1]
}

export function segmentsIntersect(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): boolean {
  const o = (p: WorldPoint, q: WorldPoint, r: WorldPoint) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}
