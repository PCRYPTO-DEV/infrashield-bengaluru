import { useEffect, useRef, useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { fetchInvest, gradeColor, INVEST_PURPOSES, type InvestPurpose, type InvestReport } from '../../data/adapters/investAdapter'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'
import { PlaceInput, type PlacePick } from './SidePanels'
import { Stones } from '../controls/Stones'

type Where = { lng: number; lat: number; name: string | null }
const num = (s: string): number | null => { const v = parseFloat(s.replace(/[, ]/g, '')); return Number.isFinite(v) && v > 0 ? v : null }

/**
 * City Atlas Pro: the UINTEL+ INVEST score. Place and purpose in, one score and a grade out, each of
 * the five signals with its reason and source. Price, rent and the permitted FAR are the person's own
 * figures (no source is connected); without them those signals say "no data".
 */
export function InvestPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [pick, setPick] = useState<PlacePick | null>(null)
  const [where, setWhere] = useState<Where | null>(null)
  const [purpose, setPurpose] = useState<InvestPurpose>('investment')
  const [price, setPrice] = useState(''); const [rent, setRent] = useState(''); const [far, setFar] = useState('')
  const [rep, setRep] = useState<InvestReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const seq = useRef(0)

  const run = async (w: Where | null = where, p: InvestPurpose = purpose) => {
    if (!w) return
    const id = ++seq.current
    setWhere(w); setBusy(true); setErr(null); setSaved(false)
    app.setPins([{ lng: w.lng, lat: w.lat, label: '₹' }])
    try {
      const r = await fetchInvest(SERVER_BASE, { lng: w.lng, lat: w.lat, purpose: p, name: w.name, price: num(price), rent: num(rent), permittedFar: num(far) })
      if (id === seq.current) setRep(r)
    } catch (e) { if (id === seq.current) setErr((e as Error).message) } finally { if (id === seq.current) setBusy(false) }
  }
  useEffect(() => {
    const i = app.investIntent
    if (i && app.can('pro.invest')) { app.investIntent = null; if (i.purpose) setPurpose(i.purpose); void run({ lng: i.lng, lat: i.lat, name: i.name }, i.purpose ?? purpose) }
  }, [app.investIntent]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { seq.current++; app.setPins([]) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: PlacePick | null) => { setPick(p); if (p) { app.flyToLngLat(p.lngLat.lng, p.lngLat.lat, Math.max(app.camera.zoom, 15)); void run({ lng: p.lngLat.lng, lat: p.lngLat.lat, name: p.label }) } }
  const useCentre = () => void run({ lng: app.lngLatOf(app.camera.centre).lng, lat: app.lngLatOf(app.camera.centre).lat, name: app.nearestAreaName(app.camera.centre) })
  const placeName = where?.name ?? rep?.name ?? (where ? `${where.lat.toFixed(4)}, ${where.lng.toFixed(4)}` : '')

  return (
    <div className="ca-panel ca-side ca-invest">
      <h3>{T('inv.title')}</h3>
      <TierGate app={app} feature="pro.invest">
        {!rep && <p className="note">{T('inv.intro')}</p>}
        <h4>{T('inv.step1')}</h4>
        <PlaceInput app={app} value={pick} onPick={go} placeholder={T('gen.where.ph')} label={T('gen.where')} />
        <div className="ca-row"><button className="small" onClick={useCentre}>{T('gen.centre')}</button></div>
        <div className="ca-chips">{INVEST_PURPOSES.map((p) => <button key={p} className={`ca-chip ${purpose === p ? 'active' : ''}`} onClick={() => { setPurpose(p); if (where) void run(where, p) }}>{T(`inv.p.${p}` as StringKey)}</button>)}</div>
        <div className="ca-inv-figs">
          <p className="note">{T('inv.figs')}</p>
          <label>{T('inv.price')}<input inputMode="numeric" value={price} placeholder="1,00,00,000" onChange={(e) => setPrice(e.target.value)} /></label>
          <label>{T('inv.rent')}<input inputMode="numeric" value={rent} placeholder="35,000" onChange={(e) => setRent(e.target.value)} /></label>
          <label>{T('inv.far')}<input inputMode="decimal" value={far} placeholder="2.5" onChange={(e) => setFar(e.target.value)} /></label>
          <button className="small primary" disabled={!where || busy} onClick={() => void run()}>{T('inv.run')}</button>
        </div>
        {busy && <p className="note">{T('inv.working')}</p>}
        {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
        {rep && <>
          <h4>{T('inv.step2')} · {placeName}</h4>
          <div className="ca-inv-head">
            <div className="ca-inv-score" style={{ borderColor: gradeColor(rep.grade), color: gradeColor(rep.grade) }}>
              <b>{rep.score === null ? '–' : Math.round(rep.score)}</b><small>{rep.grade ? T('inv.grade', { g: rep.grade }) : '—'}</small>
            </div>
            <div>
              <div className="note">{rep.score === null ? T('inv.noscore', { p: Math.round(rep.coverage * 100) }) : T('inv.cov', { p: Math.round(rep.coverage * 100) })}</div>
              <div className="note">{T(`inv.p.${rep.purpose}` as StringKey)} · {Math.round(rep.confidence * 100)}%</div>
            </div>
          </div>
          <ul className="ca-gen-bars">{rep.signals.map((s) => (
            <li key={s.key}><span>{T(`inv.s.${s.key}` as StringKey)} <small>{Math.round(s.weight * 100)}%</small></span>
              {s.score === null ? <em className="ca-nodata">{T('gen.nodata')}</em> : <span className="ca-bar"><i style={{ width: `${Math.round(s.score)}%`, background: gradeColor(rep.grade) }} /></span>}
              <small className="why">{s.class === 'your figure' ? `${T('gen.yours')} · ` : ''}{s.why.join(' ')}</small>
              {s.items && s.items.length > 0 && <small className="why">{s.items.slice(0, 3).map((it, i) => <a key={i} href={it.link} target="_blank" rel="noopener noreferrer">{it.title}{it.publisher ? ` (${it.publisher})` : ''}</a>)}</small>}
            </li>))}
          </ul>
          <h4>{T('inv.verdict')}</h4>
          <ul className="ca-inv-verdict">{rep.verdict.map((v, i) => <li key={i}>{v}</li>)}</ul>
          <details className="ca-gen-src"><summary>{T('gen.sources')}</summary>
            <table className="ca-prov"><tbody>{rep.evidence.provenance.map((p, i) => <tr key={i}><td>{p.source}</td><td>{p.resolution}</td><td>{p.count ?? ''}</td></tr>)}</tbody></table>
            <p className="note">{rep.evidence.model}</p>
          </details>
          <div className="ca-row">
            <button className="small" disabled={saved} onClick={() => { app.save({ kind: 'place', name: `UINTEL+ ${T(`inv.p.${rep.purpose}` as StringKey)}: ${placeName}`, lng: rep.centre.lng, lat: rep.centre.lat, score: rep.score, data: { grade: rep.grade, coverage: rep.coverage, signals: rep.signals.map((s) => ({ key: s.key, score: s.score })), computedAt: rep.evidence.computedAt } }); setSaved(true) }}>{saved ? T('saved.done') : T('gen.save')}</button>
            <button className="small" onClick={() => { const c = rep.centre; app.openGentrification(c.lng, c.lat, rep.name) }}>{T('gen.here')}</button>
          </div>
          <p className="note">{T('inv.notadvice')}</p>
          <Stones app={app} variant="next" exclude="worth" />
        </>}
      </TierGate>
    </div>
  )
}
