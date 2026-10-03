import { useEffect, useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'
import { apiFetch } from '../../app/tiers'

export const PURPOSES = ['cafe', 'pharmacy', 'clinic', 'school', 'shop', 'office', 'logistics', 'housing'] as const
export type Purpose = (typeof PURPOSES)[number]
const ICONS: Record<Purpose, string> = { cafe: '☕', pharmacy: '💊', clinic: '🩺', school: '🎒', shop: '🛍️', office: '🏢', logistics: '🚚', housing: '🏠' }

export interface SiteCandidate {
  cell: string; centre: { lng: number; lat: number }; boundary: number[][]; atlasScore: number | null
  score: number | null; confidence: number | null; coverage: number
  why: Array<{ key: string; score: number; weight: number; inverted: boolean; class: string; why: string[] }>
  gaps: string[]
}
export interface SiteAnswer { purpose: string; cellsChecked: number; cellsScored: number; candidates: SiteCandidate[]; computedAt: number; evidence: { classification: string; source: string; confidence: number; model: string } }

const MAX_VIEW_M = 11_000

/**
 * City Atlas Pro: the site finder, in three plain steps. 1: pick what you want to open (tiles that
 * say what matters for it). 2: the best spots on screen, each with a match bar and a verdict in
 * words. 3: "Show me" drops a numbered pin and opens the place card. Same real facts as the place
 * card; a spot with no data is never ranked.
 */
export function SiteFinderPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [purpose, setPurpose] = useState<Purpose | null>((app.sitesIntent as Purpose | null) ?? null)
  const [ans, setAns] = useState<SiteAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<number>(-1)
  const [saved, setSaved] = useState(false)
  const viewM = () => { const v = app.camera.viewBounds(); return (v.maxX - v.minX) / app.world.unitPerMetre }
  const tooWide = viewM() > MAX_VIEW_M
  const dim = (k: string) => T(`dim.${k}` as StringKey)
  const band = (score: number) => T((score >= 80 ? 'band.excellent' : score >= 60 ? 'band.good' : score >= 40 ? 'band.moderate' : 'band.poor') as StringKey).toLowerCase()

  const run = async (p: Purpose) => {
    if (viewM() > MAX_VIEW_M) { setErr(null); return }
    setBusy(true); setErr(null); setPicked(-1); setSaved(false); app.setRings([]); app.setPins([])
    try {
      const v = app.camera.viewBounds()
      const sw = app.lngLatOf({ x: v.minX, y: v.maxY }), ne = app.lngLatOf({ x: v.maxX, y: v.minY })
      const bbox = [Math.min(sw.lng, ne.lng), Math.min(sw.lat, ne.lat), Math.max(sw.lng, ne.lng), Math.max(sw.lat, ne.lat)].map((x) => x.toFixed(4)).join(',')
      const r = await apiFetch(`${SERVER_BASE}/api/sites?bbox=${bbox}&purpose=${p}&limit=5`)
      if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
      const a = (await r.json()) as SiteAnswer
      setAns(a)
      app.setRings(a.candidates.map((c) => c.boundary))
      app.setPins(a.candidates.map((c, i) => ({ lng: c.centre.lng, lat: c.centre.lat, label: String(i + 1) })))
    } catch (e) { setErr((e as Error).message); setAns(null) } finally { setBusy(false) }
  }
  // Ask Atlas already said what the person wants to open: start there.
  useEffect(() => { if (app.sitesIntent && app.can('pro.site')) { const p = app.sitesIntent as Purpose; app.sitesIntent = null; setPurpose(p); void run(p) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (p: Purpose) => { setPurpose(p); void run(p) }
  const show = (i: number) => {
    const c = ans?.candidates[i]; if (!c) return
    setPicked(i)
    app.setRings([c.boundary])
    app.flyToLngLat(c.centre.lng, c.centre.lat, Math.max(app.camera.zoom, 15.5))
    void app.openPlaceAt(c.centre.lng, c.centre.lat)
  }
  const verdict = (c: SiteCandidate) => {
    const strong = c.why.filter((w) => w.score >= 60).slice(0, 3).map((w) => `${dim(w.key).toLowerCase()}${w.inverted ? ` (${T('sites.gapgood')})` : ` ${band(w.score)}`}`)
    const weak = c.why.filter((w) => w.score < 45).slice(0, 2).map((w) => `${dim(w.key).toLowerCase()} ${band(w.score)}`)
    return { strong, weak }
  }
  return (
    <div className="ca-panel ca-side ca-sites">
      <h3>{T('sites.title')}</h3>
      <TierGate app={app} feature="pro.site">
        {!ans && <p className="note">{T('sites.intro')}</p>}
        {(!ans || !purpose) && <>
          <h4>{T('sites.step1')}</h4>
          <div className="ca-tiles">{PURPOSES.map((p) => <button key={p} className={`ca-tile ${purpose === p ? 'active' : ''}`} onClick={() => choose(p)}><b>{ICONS[p]} {T(`sites.p.${p}` as StringKey)}</b><small>{T(`sites.d.${p}` as StringKey)}</small></button>)}</div>
        </>}
        {tooWide && purpose && !ans && <p className="note" style={{ color: 'var(--risk)' }}>{T('sites.toowide')} <button className="small" onClick={() => { app.flyTo(app.camera.centre, 13.6); setTimeout(() => void run(purpose), 800) }}>{T('sites.zoomme')}</button></p>}
        {busy && <p className="note">{T('sites.working')}</p>}
        {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
        {ans && purpose && <>
          <div className="ca-row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: 13 }}>{ICONS[purpose]} {T(`sites.p.${purpose}` as StringKey)}</b>
            <span><button className="small" onClick={() => { setAns(null); setPurpose(null); app.setRings([]); app.setPins([]) }}>{T('sites.change')}</button> <button className="small" onClick={() => void run(purpose)}>{T('sites.again')}</button></span>
          </div>
          <h4>{T('sites.step2')}</h4>
          <p className="note">{T('sites.checked', { c: ans.cellsChecked, s: ans.cellsScored })}</p>
          {ans.candidates.length === 0 && <p className="note">{T('sites.none')}</p>}
          <div className="ca-sites-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ans.candidates.map((c, i) => { const v = verdict(c); const pct = Math.round(c.score ?? 0); return (
              <div key={c.cell} className={`ca-spot ${picked === i ? 'active' : ''}`}>
                <div className="ca-spot-head"><span className="ca-spot-n">{i + 1}</span><b>{i === 0 ? T('sites.best') : T('sites.rank', { n: i + 1 })}</b><span className="ca-spot-bar"><i style={{ width: `${pct}%` }} /></span><span className="ca-spot-pct">{pct}% {T('sites.match')}</span></div>
                {v.strong.length > 0 && <p><b>{T('sites.strong')}</b> {v.strong.join(', ')}.</p>}
                {v.weak.length > 0 && <p><b>{T('sites.weak')}</b> {v.weak.join(', ')}.</p>}
                {c.gaps.length > 0 && <p className="unknown">{T('sites.unknown')} {c.gaps.map(dim).join(', ')}.</p>}
                <div className="ca-row"><button className="primary" onClick={() => show(i)}>📍 {T('sites.show')}</button><small className="note">{T('sites.cover', { n: Math.round(c.coverage * 100) })}</small></div>
              </div>
            ) })}
          </div>
          {ans.candidates.length > 0 && <>
            <h4>{T('sites.step3')}</h4>
            <div className="ca-row"><button className="small" disabled={saved} onClick={() => { const c = ans.candidates[0]; app.save({ kind: 'sites', name: T('saved.sites.name', { p: T(`sites.p.${purpose}` as StringKey), n: ans.candidates.length }), lng: c.centre.lng, lat: c.centre.lat, score: c.score, data: { purpose: ans.purpose, candidates: ans.candidates, computedAt: ans.computedAt } }); setSaved(true) }}>{saved ? T('saved.done') : T('saved.add')}</button></div>
          </>}
          <p className="note"><span className="ca-badge derived">{T.cls('derived')}</span> {ans.evidence.model}</p>
        </>}
      </TierGate>
    </div>
  )
}
