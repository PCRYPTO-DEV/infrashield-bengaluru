/**
 * Gentrification (City Atlas Pro): the BSOCIAL Community Behaviour and Gentrification indices on
 * real mapped places, headlines and reported crime. Price and rent have no source, so they are
 * missing unless the person types a price trend of their own.
 */
export type GiClass = 'stable' | 'transitional' | 'emerging' | 'high'
export type CbiKey = 'family' | 'investor' | 'lifestyle' | 'engagement' | 'stability' | 'gentrification' | 'buzz'
export type GiKey = 'amenityPremium' | 'priceMomentum' | 'rentalTurnover' | 'digitalBuzz'
export type AdvisoryKey = 'infra_pressure' | 'infra_planning' | 'displacement' | 'environment' | 'law_order' | 'spillover'
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface GentriReport {
  status: 'ok'
  name: string | null
  centre: { lng: number; lat: number }
  cell: string
  counts: { total: number; cafes: number; restaurants: number; gyms: number; schools: number; hospitals: number; parks: number; banks: number; shops: number; coworking: number; premium: number }
  cbi: { value: number | null; coverage: number; components: Array<{ key: CbiKey; weight: number; value: number | null; why: string }> }
  gi: { value: number | null; class: GiClass | null; coverage: number; components: Array<{ key: GiKey; weight: number; value: number | null; class: string | null; why: string }> }
  archetypes: Array<{ id: string; label: string; probability: number }> | null
  momentum: { status: 'pending' | 'unavailable'; message: string } | {
    status: 'ok'; series: Array<{ monthsAgo: number; date: string; total: number; premium: number; food: number; ring: number; premiumAdjusted: number }>
    areaGrowth: number | null; ringGrowth: number | null; premiumFrom: number; premiumTo: number
    trend: { direction: 'accelerating' | 'steady-up' | 'flat' | 'decelerating' | 'declining'; strength: number; slope: number }
    projection: { points: Array<{ months: number; predicted: number; upper: number; lower: number; confidence: number }>; slopePerYear: number } | null
    source: string; fetchedAt: number; caveat: string
  }
  neighbours: Array<{ cell: string; centre: { lng: number; lat: number }; gi: number | null; class: GiClass | null; cbi: number | null; distanceKm: number; spillover: number; boundary: number[][] }>
  spillover: number | null
  advisory: { level: 'low' | 'moderate' | 'elevated' | 'high' | 'critical'; items: Array<{ key: AdvisoryKey; severity: Severity; gi?: number; cbi?: number; crimes?: number; cells?: string[] }>; basis: string }
  developerGrade: { grade: string | null; value?: number; coverage?: number; why: string }
  incidents90d: number
  news: { name: string; city: string | null; mentions: number; sample: Array<{ title: string; publisher: string; link: string }>; fetchedAt: number } | null
  missing: string[]
  evidence: { classification: 'derived'; confidence: number; provenance: Array<{ source: string; timestamp: number; resolution: string; count: number | null }>; computedAt: number; model: string }
}
export interface GentriPending { status: 'pending'; retryInS: number; name: string | null; message: string }
export interface GentriGrid { cells: Array<{ cell: string; gi: number | null; class: GiClass | null; places: number; boundary: number[][] }>; pending: number; computedAt: number }

/** Stable green → transitional amber → emerging orange → high red: the traffic colours people already read. */
export const GI_COLORS: Record<GiClass, string> = { stable: '#1E8E3E', transitional: '#F9AB00', emerging: '#E8710A', high: '#D93025' }
export const ADVISORY_COLORS = { low: '#1E8E3E', moderate: '#5F6368', elevated: '#F9AB00', high: '#E8710A', critical: '#D93025' } as const

export function giColor(c: GiClass | null | undefined): string { return c ? GI_COLORS[c] : '#9AA0A6' }
/** The parts of the index that had no input this time (shown as missing, never filled in). */
export function missingParts(r: Pick<GentriReport, 'gi'>): GiKey[] { return r.gi.components.filter((c) => c.value === null).map((c) => c.key) }
/** "65% of the index measured · no source yet: rental turnover, digital buzz" */
export function coverageLine(r: Pick<GentriReport, 'gi'>, T: (k: never, v?: Record<string, string | number>) => string): string {
  const miss = missingParts(r).map((k) => T(`gen.gicomp.${k}` as never).toLowerCase())
  return T('gen.cov' as never, { p: Math.round(r.gi.coverage * 100) }) + (miss.length ? ` · ${T('gen.cov.missing' as never, { m: miss.join(', ') })}` : '')
}

export async function fetchGentrification(base: string, p: { lng: number; lat: number; name?: string | null; priceTrend?: number | null }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<GentriReport | GentriPending> {
  const q = new URLSearchParams({ lng: p.lng.toFixed(5), lat: p.lat.toFixed(5) })
  if (p.name) q.set('name', p.name.slice(0, 80))
  if (p.priceTrend !== null && p.priceTrend !== undefined && Number.isFinite(p.priceTrend)) q.set('price_trend', String(p.priceTrend))
  const r = await fetchImpl(`${base}/api/gentrification?${q}`)
  if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
  return (await r.json()) as GentriReport | GentriPending
}

export async function fetchGentriGrid(base: string, bbox: { west: number; south: number; east: number; north: number }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<GentriGrid> {
  const r = await fetchImpl(`${base}/api/gentrification/grid?bbox=${[bbox.west, bbox.south, bbox.east, bbox.north].map((v) => v.toFixed(4)).join(',')}`)
  if (!r.ok) throw new Error(`gentrification grid: HTTP ${r.status}`)
  return (await r.json()) as GentriGrid
}
