import type { LngLat } from '../geo/coordinates/lngLat'

export type RegionSource = 'procedural' | 'osm'

export interface Region {
  id: string
  name: string
  origin: LngLat
  seed: string
  source: RegionSource
  /** true only for the engine demo: a made-up city with made-up traffic. Real regions never simulate data. */
  simulation: boolean
  demo?: boolean
  /** IANA zone, used for time-of-day analytics */
  timezone: string
  /** UTC offset hours used by analysers that only need a coarse local hour */
  utcOffsetHours: number
}

/** Regions mirror server/app/regions.py. Every region is real data; nothing is made up. */
export const REGIONS: Record<string, Region> = {
  ncr: { id: 'ncr', name: 'Delhi NCR', origin: { lng: 77.2167, lat: 28.6315 }, seed: 'ncr-2026', source: 'osm', simulation: false, timezone: 'Asia/Kolkata', utcOffsetHours: 5.5 },
}

/** Build-time override (VITE_DEFAULT_REGION) lets a static demo build start on the procedural city. */
export const DEFAULT_REGION: string = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string | undefined) && REGIONS[(import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string] ? ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string) : 'ncr'

export function regionFromSearch(search: string): Region {
  const p = new URLSearchParams(search)
  const id = p.get('region') ?? DEFAULT_REGION
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION]
}
