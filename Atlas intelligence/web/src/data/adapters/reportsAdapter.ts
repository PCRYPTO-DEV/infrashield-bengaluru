/** Just reported: what people said happened, where and when. Kept for a day by the server; never verified by the app. */
export type ReportKind = 'theft' | 'snatching' | 'harassment' | 'assault' | 'vandalism' | 'suspicious' | 'accident' | 'other'
export const REPORT_KINDS: ReportKind[] = ['theft', 'snatching', 'harassment', 'assault', 'vandalism', 'suspicious', 'accident', 'other']

export interface CrimeReport {
  id: string; ts: number; kind: ReportKind; description: string; lng: number; lat: number; ageMin: number
  /** who said so: a person in the app, or a crime headline in the news (placed approximately) */
  source: 'person' | 'news'; url?: string | null; precisionM?: number | null; publisher?: string | null
  evidence: { classification: 'observed'; source: string; timestamp: number; confidence: number }
}
export interface ReportList { items: CrimeReport[]; count: number; keptForS: number; note: string; computedAt: number; news?: { city?: string; unplaced?: number; error?: string | null } | null }

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

/** "This is not true": three different people hide a report for everyone. */
export async function flagReport(base: string, id: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<{ id: string; flags: number; hidden: boolean; counted: boolean }> {
  const r = await fetchImpl(`${base}/api/reports/${encodeURIComponent(id)}/flag`, { method: 'POST' })
  if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
  return (await r.json()) as { id: string; flags: number; hidden: boolean; counted: boolean }
}
