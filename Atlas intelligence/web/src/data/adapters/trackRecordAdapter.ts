/** Track record: Atlas's predictions checked against what actually happened (server back-tests on real data). */
export interface LocalityCheck {
  name: string; lng: number; lat: number; fitEnd: number
  predicted: { m6: number; m12: number; lower12: number; upper12: number; lower6: number; upper6: number }
  actual: { m6: number; m12: number }; inBand12: boolean; inBand6: boolean; ape12: number; apeNaive12: number
  predictedChange: number; actualChange: number; premiumNow: number; placesNow: number
}
export interface GentriSummary {
  localities: number; inBand12: number; inBand6: number; inBandShare12: number; medianErrorPct: number; medianErrorNaivePct: number
  directionRight: number; directionOutOf: number; rankCorrelation: number | null; topThirdActualChange: number; bottomThirdActualChange: number
}
export type GentriTrack =
  | { status: 'ok'; city: string; label: string; computedAt: number; summary: GentriSummary | null; localities: LocalityCheck[]; skipped: Array<{ name: string; why: string }>; method: string }
  | { status: 'running'; done: number; of: number; partial: GentriSummary | null; message: string }
  | { status: 'not started' }
export type TrafficTrack =
  | { status: 'ok'; checked: number; readings: number; days: number; memorySince: number | null; within10: number; within20: number; meanError: number; basis: string }
  | { status: 'waiting'; readings: number; memorySince: number | null; message: string }
export interface TrackRecord { city: string; cities: Record<string, string>; gentrification: GentriTrack; traffic: TrafficTrack }

export async function fetchTrackRecord(base: string, city = 'gurugram', fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<TrackRecord> {
  const r = await fetchImpl(`${base}/api/trackrecord?city=${encodeURIComponent(city)}`)
  if (!r.ok) throw new Error(`track record: HTTP ${r.status}`)
  return (await r.json()) as TrackRecord
}
