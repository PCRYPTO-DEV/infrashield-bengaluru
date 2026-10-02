import type { LngLat } from '../geo/coordinates/lngLat'

export type RegionSource = 'procedural' | 'osm'

export interface Region {
  id: string
  name: string
  origin: LngLat
  seed: string
  source: RegionSource
  /** IANA zone, used for time-of-day analytics */
  timezone: string
  /** UTC offset hours used by analysers that only need a coarse local hour */
  utcOffsetHours: number
}

/** Regions mirror server/app/regions.py. */
export const REGIONS: Record<string, Region> = {
  ncr: { id: 'ncr', name: 'Delhi NCR', origin: { lng: 77.2167, lat: 28.6315 }, seed: 'ncr-2026', source: 'osm', timezone: 'Asia/Kolkata', utcOffsetHours: 5.5 },
  bengaluru: { id: 'bengaluru', name: 'Bengaluru demo', origin: { lng: 77.6101, lat: 12.9719 }, seed: 'bengaluru-2026', source: 'procedural', timezone: 'Asia/Kolkata', utcOffsetHours: 5.5 },
}

/** Build-time override (VITE_DEFAULT_REGION) lets a static demo build start on the procedural city. */
export const DEFAULT_REGION: string = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string | undefined) && REGIONS[(import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string] ? ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string) : 'ncr'

export function regionFromSearch(search: string): Region {
  const p = new URLSearchParams(search)
  const id = p.get('region') ?? DEFAULT_REGION
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION]
}
