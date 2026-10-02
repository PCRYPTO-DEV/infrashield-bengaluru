/** Just reported: what people said happened, where and when. Kept for a day by the server; never verified by the app. */
export type ReportKind = 'theft' | 'snatching' | 'harassment' | 'assault' | 'vandalism' | 'suspicious' | 'accident' | 'other'
export const REPORT_KINDS: ReportKind[] = ['theft', 'snatching', 'harassment', 'assault', 'vandalism', 'suspicious', 'accident', 'other']

export interface CrimeReport {
  id: string; ts: number; kind: ReportKind; description: string; lng: number; lat: number; ageMin: number
  evidence: { classification: 'observed'; source: string; timestamp: number; confidence: number }
}
export interface ReportList { items: CrimeReport[]; count: number; keptForS: number; note: string; computedAt: number }

export async function fetchReports(base: string, bbox: { west: number; south: number; east: number; north: number }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ReportList> {
  const r = await fetchImpl(`${base}/api/reports?bbox=${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`)
  if (!r.ok) throw new Error(`reports: HTTP ${r.status}`)
  return (await r.json()) as ReportList
}

export async function postReport(base: string, body: { kind: ReportKind; description: string; lng: number; lat: number }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<CrimeReport> {
  const r = await fetchImpl(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
  return (await r.json()) as CrimeReport
}
