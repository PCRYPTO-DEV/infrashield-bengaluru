import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { Dimension, PlaceState } from '../../data/adapters/placeAdapter'
import { orderDimensions, viewScore, strengthsAndWeaknesses, questionsWorthAsking, type LifeView } from '../../intelligence/place/relevance'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'
import { clientReportHtml, openClientReport } from '../report/clientReport'
import { Stones } from '../controls/Stones'

const VIEWS: LifeView[] = ['everyone', 'family', 'student', 'professional', 'retired']

function ScoreRing({ score, band }: { score: number | null; band: string | null }) {
  const r = 26, c = 2 * Math.PI * r
  const v = score ?? 0
  return (
    <svg className={`ca-ring ${band ?? 'none'}`} viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" fontSize="18" fontWeight="600" fill="var(--fg)">{score === null ? '–' : Math.round(score)}</text>
    </svg>
  )
}

function Prov({ rows, T }: { rows: Dimension['provenance']; T: ReturnType<typeof makeT> }) {
  if (!rows.length) return null
  return (
    <table className="ca-prov"><thead><tr><th>{T('prov.source')}</th><th>{T('prov.time')}</th><th>{T('prov.res')}</th><th>{T('prov.fresh')}</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{r.source}</td><td>{r.timestamp ? new Date(r.timestamp).toISOString().slice(11, 16) + ' UTC' : '–'}</td><td>{r.resolution}</td><td>{r.freshnessS === null ? '–' : T('prov.ago', { n: Math.round(r.freshnessS / 60) })}</td></tr>)}</tbody></table>
  )
}

function Row({ d, T }: { d: Dimension; T: ReturnType<typeof makeT> }) {
  const [why, setWhy] = useState(false)
  const [ev, setEv] = useState(false)
  return (
    <li className={`ca-dim ${d.band ?? 'none'}`}>
      <div className="ca-dim-head">
        <span className="ca-dim-name">{T(`dim.${d.key}` as StringKey)}</span>
        <span className="ca-dim-val">{d.score === null ? T('place.nodata') : T(`band.${d.band}` as StringKey)}</span>
        <span className={`ca-badge ${d.class}`}>{d.class === 'inferred' ? T('cls.inferred') : T.cls(d.class)}</span>
        <button className="small" onClick={() => setWhy(!why)}>{T('place.why')}</button>
      </div>
      {d.score !== null && <div className="ca-dim-bar"><i style={{ width: `${d.score}%` }} /></div>}
      {why && <div className="ca-dim-why">
        <ul>{d.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        {d.note && <p className="note">{d.note}</p>}
        <p className="note">{T('place.confidence')}: {d.confidenceWord ? T(`conf.${d.confidenceWord}` as StringKey) : '–'}{d.confidence !== null ? ` (${Math.round(d.confidence * 100)}%)` : ''} {d.provenance.length > 0 && <button className="small" onClick={() => setEv(!ev)}>{T('place.evidence')}</button>}</p>
        {ev && <Prov rows={d.provenance} T={T} />}
      </div>}
    </li>
  )
}

function summaryText(T: ReturnType<typeof makeT>, dims: Dimension[], view: LifeView): string {
  const { strong, weak } = strengthsAndWeaknesses(dims, view)
  const name = (d: Dimension) => T(`dim.${d.key}` as StringKey).toLowerCase()
  const s = strong.map(name).join(', '), w = weak.map(name).join(', ')
  if (s && w) return T('place.summary.both', { strong: s, weak: w })
  if (s) return T('place.summary.strong', { strong: s })
  if (w) return T('place.summary.weak', { weak: w })
  return T('place.summary.none')
}

/** Click anywhere: the Atlas place intelligence card. Every score has a WHY, a class, a confidence and its evidence. */
export function PlaceCard({ app, onCompare }: { app: CityAtlas; onCompare: (name: string, st: PlaceState) => void }) {
  const T = makeT(app.language)
  const [view, setView] = useState<LifeView>('everyone')
  const [property, setProperty] = useState(false)
  const [report, setReport] = useState(false)
  const [watch, setWatch] = useState(false)
  const [watched, setWatched] = useState(false)
  if (!app.placePoint) return null
  const st = app.place
  const area = app.placePoint ? app.nearestAreaName(app.placePoint) : null
  const name = st ? (area ? `${area} · ${st.centre.lat.toFixed(3)}, ${st.centre.lng.toFixed(3)}` : `${st.centre.lat.toFixed(4)}, ${st.centre.lng.toFixed(4)}`) : ''
  return (
    <div className="ca-panel ca-side ca-placecard">
      <button className="close" onClick={() => app.closePlace()}>×</button>
      <h3>{T('place.title')}</h3>
      {app.placeLoading && <p className="note">{T('place.loading')}</p>}
      {app.placeError && <p className="note" style={{ color: 'var(--risk)' }}>{app.placeError}</p>}
      {st && <>
        <div className="ca-place-head">
          <ScoreRing score={view === 'everyone' ? st.score : viewScore(st.dimensions, view)} band={st.band} />
          <div>
            <div className="ca-place-score">{T('place.score')} <b>{(view === 'everyone' ? st.score : viewScore(st.dimensions, view)) ?? '–'}</b> / 100</div>
            <div className="note">{T('place.trend')}: {st.trend === null ? st.trendNote : `${st.trend > 0 ? '↑' : st.trend < 0 ? '↓' : '→'} ${Math.abs(st.trend)}`} · {T('place.confidence')}: {st.confidenceWord ? T(`conf.${st.confidenceWord}` as StringKey) : '–'}</div>
            <div className="note">{T('place.cell', { a: st.areaKm2 })} · {name}</div>
          </div>
        </div>
        <p className="ca-place-summary">{summaryText(T, st.dimensions, view)}</p>
        <div className="ca-views">{VIEWS.map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{T(`place.view.${v}` as StringKey)}</button>)}</div>
        {view !== 'everyone' && !app.can('place.views') ? <TierGate app={app} feature="place.views"><span /></TierGate> : (
          <ul className="ca-dims">{orderDimensions(st.dimensions, view).map((d) => <Row key={d.key} d={d} T={T} />)}</ul>
        )}
        <p className="note">{T('place.structure', { b: st.structure.buildings, r: Object.values(st.structure.roadsKm).reduce((a, b) => a + b, 0).toFixed(1), g: Math.round(st.structure.greenShare * 100), p: st.structure.paths })}</p>
        <div className="ca-row">
          <button className="small" onClick={() => setProperty(!property)}>{T('place.property')}</button>
          <button className="small" onClick={() => onCompare(name, st)}>{T('place.compare.add')}</button>
          <button className="small" onClick={() => setReport(!report)}>{T('report.btn')}</button>
          <button className="small ca-gentri-btn" title={app.can('pro.gentrification') ? '' : T('gen.locked')} onClick={() => { app.select(null); app.openGentrification(st.centre.lng, st.centre.lat, name) }}>{T('gen.here')}{!app.can('pro.gentrification') && <span className="ca-pro-tag">PRO</span>}</button>
          <button className="small ca-gentri-btn" title={app.can('pro.invest') ? '' : T('inv.locked')} onClick={() => { app.select(null); app.openInvest(st.centre.lng, st.centre.lat, name) }}>{T('inv.here')}{!app.can('pro.invest') && <span className="ca-pro-tag">PRO</span>}</button>
          <button className="small" disabled={watched} onClick={() => { if (!app.can('watchlist')) { setReport(false); setWatch(true); return } app.save({ kind: 'place', name: T('saved.place.name', { n: name }), lng: st.centre.lng, lat: st.centre.lat, score: st.score, data: { band: st.band, dimensions: st.dimensions.map((d) => ({ key: d.key, score: d.score })) } }); setWatched(true) }}>{watched ? T('saved.done') : T('saved.watch')}</button>
        </div>
        {watch && !app.can('watchlist') && <TierGate app={app} feature="watchlist"><span /></TierGate>}
        {report && <TierGate app={app} feature="pro.report">
          <p className="note">{T('report.help')}</p>
          <button className="primary small" onClick={() => { if (!openClientReport(clientReportHtml(st, name, app.changes, app.language, app.region.name))) alert(T('report.popup')) }}>{T('report.open')}</button>
        </TierGate>}
        <Stones app={app} variant="next" exclude="look" />
        {property && <TierGate app={app} feature="place.property">
          <h3>{T('place.questions')}</h3>
          <ul className="ca-questions">{questionsWorthAsking(st.dimensions).map((k) => <li key={k}>{T(k as StringKey)}</li>)}</ul>
        </TierGate>}
      </>}
    </div>
  )
}
