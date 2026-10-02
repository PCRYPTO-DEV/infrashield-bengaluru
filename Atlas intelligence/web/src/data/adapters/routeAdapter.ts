/** Whole-country place search and routing with live traffic (TomTom, through the Atlas server). */
export interface GeoResult { name: string; address: string | null; town: string | null; lat: number; lng: number; kind: string; source: string }
export interface RouteOption { index: number; lengthM: number; travelTimeS: number; trafficDelayS: number; noTrafficTravelTimeS: number | null; arrival: string | null; points: number[][]; incidentsNear: number; incidentSeverity: number; incidents: Array<{ kind: string; description: string; lng: number; lat: number }> }
export interface RouteAnswer { from: { lat: number; lng: number }; to: { lat: number; lng: number }; routes: RouteOption[]; recommended?: { fastest: number; safer: number }; explanation?: string[]; source: string; evidence: { classification: 'derived'; source: string; timestamp: number; confidence: number; model?: string } }

export async function geocode(base: string, q: string, near?: { lng: number; lat: number }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<GeoResult[]> {
  const u = `${base}/api/geocode?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`
  const r = await fetchImpl(u)
  if (!r.ok) throw new Error(`geocode: HTTP ${r.status}`)
  return ((await r.json()) as { results: GeoResult[] }).results
}

export async function routeBetween(base: string, a: { lng: number; lat: number }, b: { lng: number; lat: number }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<RouteAnswer> {
  const r = await fetchImpl(`${base}/api/route?from=${a.lat.toFixed(5)},${a.lng.toFixed(5)}&to=${b.lat.toFixed(5)},${b.lng.toFixed(5)}&alternatives=2`)
  if (!r.ok) { let d = `route: HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
  return (await r.json()) as RouteAnswer
}
