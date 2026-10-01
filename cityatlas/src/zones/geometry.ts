import type { WorldPoint } from '../geo/projection/mercator'
import { pointInPolygon } from '../geo/geometry'
import type { MonitoringZone, ZoneShape } from './types'

/** Resolve any zone shape to a polygon ring (local units). */
export function shapeToRing(shape: ZoneShape, unitPerMetre: number): WorldPoint[] {
  switch (shape.kind) {
    case 'polygon': return shape.points
    case 'radius': {
      const n = 32, out: WorldPoint[] = []
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: shape.centre.x + Math.cos(a) * shape.radius, y: shape.centre.y + Math.sin(a) * shape.radius }) }
      return out
    }
    case 'line': return bufferLine(shape.points, 6 * unitPerMetre)
    case 'corridor': return bufferLine(shape.points, shape.width / 2)
  }
}

/** Buffer a polyline into a polygon ring by offsetting both sides. */
export function bufferLine(points: WorldPoint[], half: number): WorldPoint[] {
  if (points.length < 2) return []
  const left: WorldPoint[] = [], right: WorldPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)]
    let dx = next.x - prev.x, dy = next.y - prev.y
    const l = Math.hypot(dx, dy) || 1
    dx /= l; dy /= l
    left.push({ x: p.x - dy * half, y: p.y + dx * half })
    right.push({ x: p.x + dy * half, y: p.y - dx * half })
  }
  return [...left, ...right.reverse()]
}

export function zoneContains(z: MonitoringZone, p: WorldPoint): boolean {
  if (z.ring.length < 3) return false
  return pointInPolygon(p, z.ring)
}

export function ringAreaM2(ring: WorldPoint[], groundScale: number): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y)
  return Math.abs(a / 2) * groundScale * groundScale
}
