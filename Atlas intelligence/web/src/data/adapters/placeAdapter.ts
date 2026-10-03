/** Place intelligence and What changed?: the server's H3 city model, read by the app. Every row says how it knows. */
export type EvidenceClass = 'observed' | 'derived' | 'inferred' | 'predicted'
export type Band = 'excellent' | 'good' | 'moderate' | 'poor' | 'very poor'
export interface Provenance { source: string; timestamp: number | null; resolution: string; freshnessS: number | null }
export interface Dimension { key: string; score: number | null; band: Band | null; class: EvidenceClass; confidence: number | null; confidenceWord: 'high' | 'medium' | 'low' | null; why: string[]; provenance: Provenance[]; note: string | null }
export interface PlaceState {
  cell: string; res: number; centre: { lng: number; lat: number }; boundary: number[][]; areaKm2: number
  score: number | null; band: Band | null; trend: number | null; trendNote: string | null
  confidence: number | null; confidenceWord: 'high' | 'medium' | 'low' | null
  dimensions: Dimension[]
  structure: { roadsKm: Record<string, number>; paths: number; buildings: number; greenShare: number; tilesChecked: number; entities: number }
  computedAt: number
}
export interface Change { id: string; kind: string; magnitude: number; confidence: number; relevance: number; impact: number; rank: number; lng: number | null; lat: number | null; classification: EvidenceClass; source: string; text: string; evidence: string[] }
export interface ChangeReport { since: number; count: number; items: Change[]; computedAt: number; notDetectable: string[] }

export async function fetchPlace(base: string, lng: number, lat: number, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<PlaceState> {
  const r = await fetchImpl(`${base}/api/place?lng=${lng}&lat=${lat}`)
  if (!r.ok) throw new Error(`place: HTTP ${r.status}`)
  return (await r.json()) as PlaceState
}

export async function fetchChanges(base: string, bbox: { west: number; south: number; east: number; north: number }, sinceS = 86400, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ChangeReport> {
  const r = await fetchImpl(`${base}/api/changes?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&since=${sinceS}`)
  if (!r.ok) throw new Error(`changes: HTTP ${r.status}`)
  return (await r.json()) as ChangeReport
}
