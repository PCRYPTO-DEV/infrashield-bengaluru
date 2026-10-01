import { clampLat, type LngLat } from '../coordinates/lngLat'

/**
 * Web Mercator (EPSG:3857) projection into "world units" (metres at the
 * equator). World x grows east; world y grows SOUTH (screen convention),
 * which keeps every renderer transform a plain scale + translate.
 */
export const EARTH_CIRCUMFERENCE_M = 40075016.68557849
export const HALF_WORLD = EARTH_CIRCUMFERENCE_M / 2
const R = EARTH_CIRCUMFERENCE_M / (2 * Math.PI)

export interface WorldPoint { x: number; y: number }
export interface WorldBounds { minX: number; minY: number; maxX: number; maxY: number }

export function lngLatToWorld(p: LngLat): WorldPoint {
  const lat = clampLat(p.lat)
  const x = R * (p.lng * Math.PI) / 180
  const yNorth = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return { x, y: -yNorth }
}

export function worldToLngLat(p: WorldPoint): LngLat {
  const lng = (p.x / R) * (180 / Math.PI)
  const lat = (2 * Math.atan(Math.exp(-p.y / R)) - Math.PI / 2) * (180 / Math.PI)
  return { lng, lat }
}

/** Ground metres per world unit at a latitude (inverse Mercator scale factor). */
export function groundScale(lat: number): number {
  return Math.cos((lat * Math.PI) / 180)
}

/** Pixels per world unit for a web-map style zoom level. */
export function pixelsPerWorldUnit(zoom: number, tileSize = 256): number {
  return (tileSize * Math.pow(2, zoom)) / EARTH_CIRCUMFERENCE_M
}

export function zoomForPixelsPerWorldUnit(ppu: number, tileSize = 256): number {
  return Math.log2((ppu * EARTH_CIRCUMFERENCE_M) / tileSize)
}
