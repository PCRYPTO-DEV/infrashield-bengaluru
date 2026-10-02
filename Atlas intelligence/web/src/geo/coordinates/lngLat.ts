export interface LngLat { lng: number; lat: number }

export interface GeoBounds { west: number; south: number; east: number; north: number }

const EARTH_RADIUS_M = 6371008.8

export function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat))
}

export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/** Great-circle distance in metres (haversine). */
export function haversineM(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function boundsContain(b: GeoBounds, p: LngLat): boolean {
  return p.lng >= b.west && p.lng <= b.east && p.lat >= b.south && p.lat <= b.north
}

export function boundsIntersect(a: GeoBounds, b: GeoBounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}
