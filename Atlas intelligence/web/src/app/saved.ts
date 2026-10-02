/**
 * Saved areas, shortlists and scenarios: a project workspace kept in this browser for now
 * (localStorage), exportable as GeoJSON or CSV. Accounts and shared projects come with billing.
 * Everything saved is a copy of real evidence shown at the time, with its timestamp.
 */
export type SavedKind = 'place' | 'sites' | 'scenario' | 'route'
export interface SavedItem {
  id: string
  kind: SavedKind
  name: string
  /** when it was saved, epoch ms */
  at: number
  /** a point to fly to */
  lng: number
  lat: number
  /** the score at save time, when the item has one */
  score?: number | null
  /** the saved evidence, as shown then */
  data: unknown
}

const KEY = 'atlas.saved'

export function loadSaved(): SavedItem[] { try { const raw = localStorage.getItem(KEY); const v = raw ? (JSON.parse(raw) as SavedItem[]) : []; return Array.isArray(v) ? v : [] } catch { return [] } }
export function saveItem(item: Omit<SavedItem, 'id' | 'at'>): SavedItem { const it: SavedItem = { ...item, id: `${item.kind}:${Date.now().toString(36)}`, at: Date.now() }; const all = [it, ...loadSaved()].slice(0, 200); try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* private mode */ } return it }
export function removeSaved(id: string): SavedItem[] { const all = loadSaved().filter((i) => i.id !== id); try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* private mode */ } return all }

/** GeoJSON of saved items: a point per place or scenario, a polygon per shortlisted cell. */
export function savedToGeoJSON(items: SavedItem[]): string {
  const features: unknown[] = []
  for (const it of items) {
    const base = { id: it.id, kind: it.kind, name: it.name, savedAt: new Date(it.at).toISOString(), score: it.score ?? null }
    if (it.kind === 'sites') {
      const d = it.data as { purpose?: string; candidates?: Array<{ cell: string; boundary: number[][]; score: number | null; why: unknown; gaps: string[] }> }
      for (const [i, c] of (d.candidates ?? []).entries()) features.push({ type: 'Feature', properties: { ...base, rank: i + 1, cell: c.cell, purpose: d.purpose, score: c.score, why: c.why, gaps: c.gaps }, geometry: { type: 'Polygon', coordinates: [[...c.boundary, c.boundary[0]]] } })
    } else features.push({ type: 'Feature', properties: { ...base, data: it.data }, geometry: { type: 'Point', coordinates: [it.lng, it.lat] } })
  }
  return JSON.stringify({ type: 'FeatureCollection', features, generator: 'City Atlas', note: 'real data only; "no data" is never replaced by a guess' }, null, 1)
}

export function savedToCSV(items: SavedItem[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = [['id', 'kind', 'name', 'savedAt', 'lng', 'lat', 'score', 'summary'].join(',')]
  for (const it of items) {
    let summary = ''
    if (it.kind === 'sites') { const d = it.data as { purpose?: string; candidates?: Array<{ score: number | null }> }; summary = `${d.purpose}: ${(d.candidates ?? []).map((c, i) => `#${i + 1} ${Math.round(c.score ?? 0)}`).join(' ')}` }
    else if (it.kind === 'scenario') { const d = it.data as { deltaMin?: number; baseMin?: number; closedMin?: number }; summary = `closure adds ${d.deltaMin} min (${d.baseMin} → ${d.closedMin})` }
    else if (it.kind === 'place') { const d = it.data as { band?: string | null }; summary = d.band ?? '' }
    rows.push([it.id, it.kind, it.name, new Date(it.at).toISOString(), it.lng, it.lat, it.score ?? '', summary].map(esc).join(','))
  }
  return rows.join('\n')
}

export function download(name: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
