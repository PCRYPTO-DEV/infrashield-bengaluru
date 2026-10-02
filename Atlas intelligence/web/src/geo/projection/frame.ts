import type { LngLat } from '../coordinates/lngLat'
import { groundScale, lngLatToWorld, worldToLngLat, type WorldPoint } from './mercator'

/**
 * A WorldFrame is a local origin in Mercator space. All render and
 * simulation coordinates are expressed relative to it so values stay small
 * enough for float32 (SVG viewBox and Canvas transforms jitter above ~1e5).
 */
export interface WorldFrame {
  originX: number
  originY: number
  /** metres of ground per local unit at the frame's reference latitude */
  groundScale: number
  referenceLat: number
}

export function createFrame(reference: LngLat): WorldFrame {
  const o = lngLatToWorld(reference)
  return { originX: o.x, originY: o.y, groundScale: groundScale(reference.lat), referenceLat: reference.lat }
}

export function toLocal(frame: WorldFrame, p: WorldPoint): WorldPoint {
  return { x: p.x - frame.originX, y: p.y - frame.originY }
}

export function fromLocal(frame: WorldFrame, p: WorldPoint): WorldPoint {
  return { x: p.x + frame.originX, y: p.y + frame.originY }
}

export function lngLatToLocal(frame: WorldFrame, p: LngLat): WorldPoint {
  return toLocal(frame, lngLatToWorld(p))
}

export function localToLngLat(frame: WorldFrame, p: WorldPoint): LngLat {
  return worldToLngLat(fromLocal(frame, p))
}

/** Convert a ground speed (m/s) to local units per second. */
export function groundToLocalSpeed(frame: WorldFrame, metresPerSecond: number): number {
  return metresPerSecond / frame.groundScale
}
