import { useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'

export const PURPOSES = ['cafe', 'pharmacy', 'clinic', 'school', 'shop', 'office', 'logistics', 'housing'] as const
export type Purpose = (typeof PURPOSES)[number]

export interface SiteCandidate {
  cell: string; centre: { lng: number; lat: number }; boundary: number[][]; atlasScore: number | null
  score: number | null; confidence: number | null; coverage: number
  why: Array<{ key: string; score: number; weight: number; inverted: boolean; class: string; why: string[] }>
  gaps: string[]
}
export interface SiteAnswer { purpose: string; cellsChecked: number; cellsScored: number; candidates: SiteCandidate[]; computedAt: number; evidence: { classification: string; source: string; confidence: number; model: string } }

/**
 * City Atlas Pro: the site finder. Ranks the hexagons on screen for a purpose from the same real
 * place-card dimensions; a gap in supply (no pharmacy near) counts for a pharmacy. Cells without
 * data are not ranked, and every candidate says why.
 */
export function SiteFinderPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [purpose, setPurpose] = useState<Purpose>('cafe')
  const [ans, setAns] = useState<SiteAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<number>(-1)
  const [saved, setSaved] = useState(false)
  const run = async (p: Purpose = purpose) => {
    setBusy(true); setErr(null); setPicked(-1); setSaved(false); app.setRings([])
    try {
      const v = app.camera.viewBounds()
      const sw = app.lngLatOf({ x: v.minX, y: v.maxY }), ne = app.lngLatOf({ x: v.maxX, y: v.minY })
      const bbox = [Math.min(sw.lng, ne.lng), Math.min(sw.lat, ne.lat), Math.max(sw.lng, ne.lng), Math.max(sw.lat, ne.lat)].map((x) => x.toFixed(4)).join(',')
      const r = await fetch(`${SERVER_BASE}/api/sites?bbox=${bbox}&purpose=${p}&limit=6`)
      if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
      const a = (await r.json()) as SiteAnswer
      setAns(a)
      app.setRings(a.candidates.map((c) => c.boundary))
    } catch (e) { setErr((e as Error).message); setAns(null) } finally { setBusy(false) }
  }
  const show = (i: number) => {
    const c = ans?.candidates[i]; if (!c) return
    setPicked(i)
    app.setRings([c.boundary])
    void app.openPlaceAt(c.centre.lng, c.centre.lat)
  }
  return (
    <div className="ca-panel ca-side ca-sites">
      <h3>{T('sites.title')}</h3>
      <TierGate app={app} feature="pro.site">
        <p className="note">{T('sites.help')}</p>
        <div className="ca-chips">{PURPOSES.map((p) => <button key={p} className={`ca-chip ${purpose === p ? 'active' : ''}`} onClick={() => { setPurpose(p); void run(p) }}>{T(`sites.p.${p}` as StringKey)}</button>)}</div>
        <div className="ca-row"><button className="primary" disabled={busy} onClick={() => void run()}>{busy ? '…' : T('sites.go')}</button>{ans && <button className="small" onClick={() => { setAns(null); app.setRings([]) }}>{T('sites.clear')}</button>}</div>
        {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
        {ans && <>
          <p className="note">{T('sites.found', { n: ans.candidates.length, c: ans.cellsChecked, s: ans.cellsScored })}</p>
          {ans.candidates.length === 0 && <p className="note">{T('sites.none')}</p>}
          <ol className="ca-sites-list">
            {ans.candidates.map((c, i) => <li key={c.cell} className={picked === i ? 'active' : ''}>
              <button className="ca-site" onClick={() => show(i)}>
                <b>{Math.round(c.score ?? 0)}</b>
                <span>
                  <span className="ca-site-head">{T('sites.rank', { n: i + 1 })} · {T('sites.cover', { n: Math.round(c.coverage * 100) })}</span>
                  <small>{c.why.slice(0, 3).map((w) => `${T(`dim.${w.key}` as StringKey)} ${Math.round(w.score)}${w.inverted ? ` (${T('sites.gap')})` : ''}`).join(' · ')}</small>
                  {c.gaps.length > 0 && <small className="ca-site-gaps">{T('sites.nodata', { d: c.gaps.map((g) => T(`dim.${g}` as StringKey)).join(', ') })}</small>}
                </span>
              </button>
            </li>)}
          </ol>
          {ans.candidates.length > 0 && <button className="small" disabled={saved} onClick={() => { const c = ans.candidates[0]; app.save({ kind: 'sites', name: T('saved.sites.name', { p: T(`sites.p.${purpose}` as StringKey), n: ans.candidates.length }), lng: c.centre.lng, lat: c.centre.lat, score: c.score, data: { purpose: ans.purpose, candidates: ans.candidates, computedAt: ans.computedAt } }); setSaved(true) }}>{saved ? T('saved.done') : T('saved.add')}</button>}
          <p className="note"><span className="ca-badge derived">{T.cls('derived')}</span> {ans.evidence.source} · {ans.evidence.model}</p>
        </>}
      </TierGate>
    </div>
  )
}
