import { useEffect, useRef, useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { ADVISORY_COLORS, coverageLine, fetchGentrification, giColor, type GentriPending, type GentriReport } from '../../data/adapters/gentrificationAdapter'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'
import { PlaceInput, type PlacePick } from './SidePanels'

type Where = { lng: number; lat: number; name: string | null }

function Dial({ value, cls, coverage }: { value: number | null; cls: string | null; coverage: number }) {
  const r = 34, c = 2 * Math.PI * r, rc = 41, cc = 2 * Math.PI * rc
  return (
    <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" className="ca-gen-dial">
      <circle cx="48" cy="48" r={rc} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle cx="48" cy="48" r={rc} fill="none" stroke="#5F6368" strokeWidth="3" strokeDasharray={`${cc * coverage} ${cc}`} transform="rotate(-90 48 48)" />
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle cx="48" cy="48" r={r} fill="none" stroke={giColor(cls as never)} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(c * (value ?? 0)) / 100} ${c}`} transform="rotate(-90 48 48)" />
      <text x="48" y="54" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--fg)">{value === null ? '–' : value}</text>
    </svg>
  )
}

function Spark({ ys }: { ys: number[] }) {
  if (ys.length < 2) return null
  const w = 220, h = 44, lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1
  const pts = ys.map((y, i) => `${(i / (ys.length - 1)) * (w - 8) + 4},${h - 4 - ((y - lo) / span) * (h - 8)}`).join(' ')
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true"><polyline points={pts} fill="none" stroke="#0F6FFF" strokeWidth="2.5" strokeLinejoin="round" />{ys.map((y, i) => <circle key={i} cx={(i / (ys.length - 1)) * (w - 8) + 4} cy={h - 4 - ((y - lo) / span) * (h - 8)} r="3" fill="#0F6FFF" />)}</svg>
}

/**
 * City Atlas Pro: is this area gentrifying? BSOCIAL's community and gentrification indices on the
 * places people mapped, two years of map history, headlines and reported crime. What has no source
 * (price, rent, liquidity, households) is shown as missing, never filled in.
 */
export function GentrificationPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [pick, setPick] = useState<PlacePick | null>(null)
  const [where, setWhere] = useState<Where | null>(null)
  const [rep, setRep] = useState<GentriReport | null>(null)
  const [pending, setPending] = useState<GentriPending | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = async (w: Where, priceTrend: number | null = null, attempt = 0) => {
    const id = ++seq.current
    if (timer.current) clearTimeout(timer.current)
    setWhere(w); setBusy(true); setErr(null); setSaved(false); if (attempt === 0) { setRep(null); setPending(null) }
    app.setPins([{ lng: w.lng, lat: w.lat, label: '●' }])
    try {
      const r = await fetchGentrification(SERVER_BASE, { lng: w.lng, lat: w.lat, name: w.name, priceTrend })
      if (id !== seq.current) return
      if (r.status === 'pending') {
        setPending(r)
        if (attempt < 30) timer.current = setTimeout(() => void run(w, priceTrend, attempt + 1), (r.retryInS || 5) * 1000)
      } else {
        setPending(null); setRep(r)
        app.setRings(r.neighbours.filter((n) => n.gi !== null).map((n) => n.boundary))
        // the two-year history arrives a little later the first time: ask again quietly
        if (r.momentum.status === 'pending' && attempt < 30) timer.current = setTimeout(() => void run(w, priceTrend, attempt + 1), 8000)
      }
    } catch (e) { if (id === seq.current) setErr((e as Error).message) } finally { if (id === seq.current) setBusy(false) }
  }
  // Opened from Ask Atlas, the place card or a hex: start there.
  useEffect(() => {
    const i = app.gentriIntent
    if (i && app.can('pro.gentrification')) { app.gentriIntent = null; void run({ lng: i.lng, lat: i.lat, name: i.name }) }
  }, [app.gentriIntent]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { seq.current++; if (timer.current) clearTimeout(timer.current); app.setPins([]); app.setRings([]) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: PlacePick | null) => { setPick(p); if (p) { app.flyToLngLat(p.lngLat.lng, p.lngLat.lat, Math.max(app.camera.zoom, 14.5)); void run({ lng: p.lngLat.lng, lat: p.lngLat.lat, name: p.label }) } }
  const useCentre = () => { const c = app.lngLatOf(app.camera.centre); void run({ lng: c.lng, lat: c.lat, name: app.nearestAreaName(app.camera.centre) }) }
  const tapMap = () => app.pickMapPoint(T('gen.pick.hint'), (p, ll) => void run({ lng: ll.lng, lat: ll.lat, name: app.nearestAreaName(p) }))
  const applyPrice = () => { const v = parseFloat(price); if (where) void run(where, Number.isFinite(v) ? Math.max(-50, Math.min(100, v)) : null) }
  const placeName = where?.name ?? rep?.name ?? (where ? `${where.lat.toFixed(4)}, ${where.lng.toFixed(4)}` : '')

  return (
    <div className="ca-panel ca-side ca-gentri">
      <h3>{T('gen.title')}</h3>
      <TierGate app={app} feature="pro.gentrification">
        {!rep && !pending && <p className="note">{T('gen.intro')}</p>}
        <h4>{T('gen.step1')}</h4>
        <PlaceInput app={app} value={pick} onPick={go} placeholder={T('gen.where.ph')} label={T('gen.where')} />
        <div className="ca-row">
          <button className="small" onClick={useCentre}>{T('gen.centre')}</button>
          <button className="small" onClick={tapMap}>{T('gen.pickmap')}</button>
          <button className={`small ${app.gentriLayer ? 'active' : ''}`} onClick={() => app.setGentriLayer(!app.gentriLayer)}>{app.gentriLayer ? T('gen.layer.off') : T('gen.layer.on')}</button>
        </div>
        {app.gentriLayer && <p className="note">{T('gen.layer.legend')}{app.gentriPending > 0 ? ` ${T('gen.layer.pending', { n: app.gentriPending })}` : ''}</p>}
        {busy && !pending && <p className="note">{T('gen.working')}</p>}
        {pending && <p className="note">{T('gen.pending')}</p>}
        {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
        {rep && <>
          <h4>{T('gen.step2')} · {placeName}</h4>
          <div className="ca-gen-head">
            <Dial value={rep.gi.value} cls={rep.gi.class} coverage={rep.gi.coverage} />
            <div>
              <div className="ca-gen-class" style={{ color: giColor(rep.gi.class) }}>{rep.gi.class ? T(`gen.class.${rep.gi.class}` as StringKey) : T('gen.nodata')}</div>
              <div className="note">{T('gen.gi')} · {coverageLine(rep, T as never)}</div>
              <div className="note">{T('gen.cbi')}: <b>{rep.cbi.value ?? '–'}</b> / 100 · {T('gen.places', { n: rep.counts.total })}</div>
            </div>
          </div>
          <ul className="ca-gen-bars">{rep.gi.components.map((c) => (
            <li key={c.key}><span>{T(`gen.gicomp.${c.key}` as StringKey)} <small>{Math.round(c.weight * 100)}%</small></span>
              {c.value === null ? <em className="ca-nodata">{T('gen.nodata')}</em> : <span className="ca-bar"><i style={{ width: `${Math.round(c.value * 100)}%`, background: giColor(rep.gi.class) }} /></span>}
              <small className="why">{c.class === 'your figure' ? `${T('gen.yours')} · ` : ''}{c.why}</small></li>))}
          </ul>
          <label className="ca-gen-price">{T('gen.price')}
            <span className="ca-row"><input type="number" inputMode="decimal" step="0.5" value={price} placeholder="e.g. 8" onChange={(e) => setPrice(e.target.value)} /><button className="small" onClick={applyPrice}>{T('gen.apply')}</button></span>
            <small className="note">{T('gen.price.help')}</small>
          </label>

          <h4>{T('gen.cbi')}</h4>
          <ul className="ca-gen-bars">{rep.cbi.components.map((c) => (
            <li key={c.key} onClick={() => setOpen(open === c.key ? null : c.key)} className="clickable">
              <span>{T(`gen.cbi.${c.key}` as StringKey)}</span>
              {c.value === null ? <em className="ca-nodata">{T('gen.nodata')}</em> : <span className="ca-bar"><i style={{ width: `${Math.round(c.value * 100)}%` }} /></span>}
              {open === c.key && <small className="why">{c.why}</small>}
            </li>))}
          </ul>

          {rep.archetypes && <>
            <h4>{T('gen.arch')}</h4>
            <div className="ca-chips">{rep.archetypes.slice(0, 2).map((a, i) => <span key={a.id} className={`ca-chip ${i === 0 ? 'active' : ''}`}>{T(`gen.arch.${a.id}` as StringKey)} · {Math.round(a.probability * 100)}%</span>)}</div>
            <p className="note">{T('gen.arch.note')}</p>
          </>}

          <h4>{T('gen.mom')}</h4>
          {rep.momentum.status !== 'ok' ? <p className="note">{rep.momentum.status === 'pending' ? T('gen.mom.pending') : rep.momentum.message}</p> : <>
            <Spark ys={rep.momentum.series.map((s) => s.premiumAdjusted)} />
            <p>{T('gen.mom.line', { a: rep.momentum.premiumFrom, b: rep.momentum.premiumTo, g: rep.momentum.areaGrowth ?? '–', r: rep.momentum.ringGrowth ?? '–' })} <b>{T(`gen.trend.${rep.momentum.trend.direction}` as StringKey)}</b>.</p>
            <p className="note">{rep.momentum.projection ? T('gen.proj', { p: Math.round(rep.momentum.projection.points[1].predicted), lo: Math.round(rep.momentum.projection.points[1].lower), hi: Math.round(rep.momentum.projection.points[1].upper) }) : T('gen.proj.none')}</p>
            <p className="note">{T('gen.mom.caveat')}</p>
          </>}

          <h4>{T('gen.adv')} · <span style={{ color: ADVISORY_COLORS[rep.advisory.level] }}>{T(`gen.adv.level.${rep.advisory.level}` as StringKey)}</span></h4>
          {rep.advisory.items.length === 0 ? <p className="note">{T('gen.adv.none')}</p> : <ul className="ca-gen-adv">{rep.advisory.items.map((a, i) => (
            <li key={i} className={`sev-${a.severity}`}>{T(`gen.adv.${a.key}` as StringKey, { gi: a.gi ?? '', cbi: a.cbi ?? '', crimes: a.crimes ?? '', n: a.cells?.length ?? 0 })}</li>))}
          </ul>}
          <p className="note">{T('gen.crime', { n: rep.incidents90d })}{rep.news ? ` ${T('gen.news', { n: rep.news.mentions, a: rep.news.name })}` : ''}</p>
          {rep.spillover !== null && <p className="note">{T('gen.neigh.line', { s: rep.spillover })}</p>}

          <h4>{T('gen.grade')}: {rep.developerGrade.grade ?? '–'}</h4>
          <p className="note">{rep.developerGrade.grade ? rep.developerGrade.why : T('gen.grade.none')}</p>

          <details className="ca-gen-src"><summary>{T('gen.sources')}</summary>
            <table className="ca-prov"><tbody>{rep.evidence.provenance.map((p, i) => <tr key={i}><td>{p.source}</td><td>{p.resolution}</td><td>{p.count ?? ''}</td><td>{new Date(p.timestamp).toISOString().slice(0, 10)}</td></tr>)}</tbody></table>
            <p className="note">{T('gen.missing', { m: rep.missing.join(', ') })}</p>
            <p className="note">{rep.evidence.model}</p>
          </details>
          <div className="ca-row">
            <button className="small" disabled={saved} onClick={() => { app.save({ kind: 'place', name: `${T('tool.gentrification')}: ${placeName}`, lng: rep.centre.lng, lat: rep.centre.lat, score: rep.gi.value, data: { gi: rep.gi, cbi: rep.cbi.value, archetype: rep.archetypes?.[0]?.id ?? null, advisory: rep.advisory.level, computedAt: rep.evidence.computedAt } }); setSaved(true) }}>{saved ? T('saved.done') : T('gen.save')}</button>
            <button className="small" onClick={() => { setRep(null); setPending(null); setPick(null); setWhere(null); app.setPins([]); app.setRings([]) }}>{T('gen.again')}</button>
          </div>
          <p className="note"><span className="ca-badge derived">{T.cls('derived')}</span> {Math.round(rep.evidence.confidence * 100)}%</p>
        </>}
      </TierGate>
    </div>
  )
}
