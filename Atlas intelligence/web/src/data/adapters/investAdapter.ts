/** UINTEL+ INVEST score (City Atlas Pro): five real signals with the deck's weights; information, not advice. */
export type InvestPurpose = 'investment' | 'office' | 'home' | 'retail' | 'risk'
export const INVEST_PURPOSES: InvestPurpose[] = ['investment', 'home', 'office', 'retail', 'risk']
export type SignalKey = 'yield' | 'fsiGap' | 'distress' | 'supply' | 'infrastructure'
export interface InvestSignal { key: SignalKey; weight: number; score: number | null; class: string | null; confidence: number | null; value: number | null; why: string[]; builtFar?: number | null; items?: Array<{ title: string; publisher: string; link: string }>; parts?: Array<{ key: string; score: number; why: string }> }
export interface InvestReport {
  name: string | null; centre: { lng: number; lat: number }; purpose: InvestPurpose
  score: number | null; grade: 'A+' | 'A' | 'B' | 'C' | 'D' | null; coverage: number; confidence: number; partial: number | null
  signals: InvestSignal[]; verdict: string[]; missing: SignalKey[]; note: string
  evidence: { classification: 'derived'; confidence: number; provenance: Array<{ source: string; timestamp: number; resolution: string; count: number | null }>; computedAt: number; model: string }
}
export const GRADE_COLORS: Record<string, string> = { 'A+': '#1E8E3E', A: '#34A853', B: '#F9AB00', C: '#E8710A', D: '#D93025' }
export function gradeColor(g: string | null): string { return g ? GRADE_COLORS[g] ?? '#5F6368' : '#9AA0A6' }

export async function fetchInvest(base: string, p: { lng: number; lat: number; purpose: InvestPurpose; name?: string | null; price?: number | null; rent?: number | null; permittedFar?: number | null }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<InvestReport> {
  const q = new URLSearchParams({ lng: p.lng.toFixed(5), lat: p.lat.toFixed(5), purpose: p.purpose })
  if (p.name) q.set('name', p.name.slice(0, 80))
  const pos = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(v) && v > 0
  if (pos(p.price) && pos(p.rent)) { q.set('price', String(p.price)); q.set('rent', String(p.rent)) }
  if (pos(p.permittedFar)) q.set('permitted_far', String(p.permittedFar))
  const r = await fetchImpl(`${base}/api/invest?${q}`)
  if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
  return (await r.json()) as InvestReport
}
