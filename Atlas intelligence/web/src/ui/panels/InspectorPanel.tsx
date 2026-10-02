import { useEffect, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { Prediction } from '../../intelligence/types'
import type { RoadProperties } from '../../entities/types'
import { localToLngLat } from '../../geo/projection/frame'
import { makeT } from '../i18n'

const SKIP = new Set(['edgeIds', 'osm'])
const fmtT = (ts?: number) => (ts ? new Date(ts).toISOString().slice(11, 19) + ' UTC' : '—')

/** What · kind · now · time · from · how sure · history · nearby events · our guess. Fields appear only when they exist. */
export function InspectorPanel({ app }: { app: CityAtlas }) {
  const sel = app.selection
  const T = makeT(app.language)
  const [pred, setPred] = useState<Prediction | undefined>()
  useEffect(() => {
    let alive = true
    if (sel?.kind === 'agent') { const t = setInterval(async () => { const p = await app.intel.predict(sel.id, 45); if (alive) setPred(p) }, 700); return () => { alive = false; clearInterval(t) } }
    setPred(undefined)
  }, [sel?.kind, sel && sel.id, app])
  if (!sel) return null
  const upm = app.world.unitPerMetre
  const now = app.temporal.current.timestamp

  if (sel.kind === 'agent') {
    const a = app.world.agents.get(sel.id)
    if (!a) return <div className="ca-panel ca-inspector"><h3>{T('insp.title')}</h3><p>{T('insp.gone')}</p><button className="close" onClick={() => app.select(null)}>×</button>
      {app.placePoint && <button className="small ca-area-btn" onClick={() => app.select(null)}>{T('place.title')}</button>}</div>
    const edge = app.world.graph.edge(a.edgeId)
    const road = edge && app.world.entities.get(edge.roadId)
    const roadName = (road?.entity.properties as RoadProperties | undefined)?.name
    const ll = localToLngLat(app.frame, a)
    const anomalies = app.intel.state.anomalies.filter((x) => x.entityIds.includes(`agent:${a.id}`))
    const related = app.memory.near(a, 80 * upm, now - 30 * 60000, now).slice(0, 6)
    const hist = a.history.slice(-24)
    const maxS = Math.max(0.1, ...hist.map((h) => h.speed))
    const kind = T(a.kind === 'vehicle' ? 'insp.vehicle' : 'insp.pedestrian')
    return (
      <div className="ca-panel ca-inspector">
        <button className="close" onClick={() => app.select(null)}>×</button>
        {app.placePoint && <button className="small ca-area-btn" onClick={() => app.select(null)}>{T('place.title')}</button>}
        <h3>{T('insp.title')}</h3>
        <dl>
          <dt>{T('insp.what')}</dt><dd>{kind} #{a.id}</dd>
          <dt>{T('insp.state')}</dt><dd>{a.speed < 0.3 ? T('insp.stopped') : T('insp.moving')} · {((a.speed / upm) * 3.6).toFixed(0)} km/h · {T('insp.heading')} {Math.round(((a.heading * 180) / Math.PI + 360) % 360)}°</dd>
          {roadName && <><dt>{T('insp.on')}</dt><dd>{roadName} <small>({edge?.roadClass})</small></dd></>}
          <dt>{T('insp.pos')}</dt><dd>{ll.lat.toFixed(5)}, {ll.lng.toFixed(5)}</dd>
          <dt>{T('insp.time')}</dt><dd>{fmtT(a.lastSeen)}</dd>
          <dt>{T('insp.source')}</dt><dd><span className={`ca-badge ${a.evidence.classification}`}>{T.cls(a.evidence.classification)}</span> {a.evidence.source}</dd>
          {a.evidence.confidence !== undefined && <><dt>{T('insp.conf')}</dt><dd>{Math.round(a.evidence.confidence * 100)}%</dd></>}
        </dl>
        {hist.length > 1 && <><h3>{T('insp.history', { n: hist.length })}</h3><div className="ca-spark">{hist.map((h, i) => <i key={i} style={{ height: `${(h.speed / maxS) * 100}%` }} />)}</div></>}
        {anomalies.length > 0 && <><h3>{T('insp.anomalies')}</h3><div className="ca-events"><ul>{anomalies.map((x) => <li key={x.id}><b>{x.type.replace('_', ' ')}</b> — {x.explanation} <small>{x.evidence.join('; ')}</small></li>)}</ul></div></>}
        {related.length > 0 && <><h3>{T('insp.related', { m: 30, d: 80 })}</h3><div className="ca-events"><ul>{related.map((e) => <li key={e.id}><time>{fmtT(e.timestamp)}</time>{e.description}</li>)}</ul></div></>}
        {pred && <><h3>{T('insp.prediction')}</h3><p style={{ margin: 0 }}><span className="ca-badge predicted">{T.cls('predicted')}</span> {T('insp.pred.text', { s: pred.horizonS, c: Math.round(pred.confidence * 100), m: Math.round(pred.envelope[pred.envelope.length - 1] / upm) })} {pred.alternatives.length ? T('insp.pred.alt', { n: pred.alternatives.length }) : ''}</p></>}
      </div>
    )
  }

  const ie = app.world.entities.get(sel.id)
  if (!ie) return null
  const e = ie.entity
  const props = Object.entries(e.properties).filter(([k, v]) => !SKIP.has(k) && v !== undefined && v !== null && typeof v !== 'object')
  const centre = { x: (ie.bounds.minX + ie.bounds.maxX) / 2, y: (ie.bounds.minY + ie.bounds.maxY) / 2 }
  const related = app.memory.near(centre, 60 * upm, now - 60 * 60000, now).slice(0, 8)
  const flows = e.type === 'road' ? ((e.properties as RoadProperties).edgeIds ?? []).map((id) => app.intel.state.flow?.edges.get(id)).filter(Boolean) : []
  const observedFlows = flows.filter((f) => f?.observed)
  const count = flows.reduce((s, f) => s + (f?.count ?? 0), 0)
  const cong = flows.length ? flows.reduce((s, f) => s + (f?.congestion ?? 0), 0) / flows.length : 0
  const forecast = e.type === 'road' ? ((e.properties as RoadProperties).edgeIds ?? []).map((id) => app.intel.state.forecast?.edges.get(id)).filter(Boolean) : []
  const fcIdx = (app.intel.state.forecast?.horizonsMin.length ?? 1) - 1
  const fc = forecast.length ? forecast.reduce((s, v) => s + (v?.[fcIdx] ?? 0), 0) / forecast.length : null
  return (
    <div className="ca-panel ca-inspector">
      <button className="close" onClick={() => app.select(null)}>×</button>
      {app.placePoint && <button className="small ca-area-btn" onClick={() => app.select(null)}>{T('place.title')}</button>}
      <h3>{T('insp.title')}</h3>
      <dl>
        <dt>{T('insp.what')}</dt><dd>{String(e.properties.name ?? e.id)}</dd>
        <dt>{T('insp.type')}</dt><dd>{e.type.replace(/_/g, ' ')}</dd>
        {e.type === 'road' && flows.length > 0 && <><dt>{T('insp.state')}</dt><dd>{T('insp.cars', { n: count, c: cong.toFixed(2) })} <span className="ca-badge derived">{T.cls('derived')}</span></dd></>}
        {observedFlows.length > 0 && <><dt>{T('insp.livespeed')}</dt><dd>{T('insp.offree', { n: Math.round((observedFlows.reduce((s, f) => s + (f?.speedRatio ?? 0), 0) / observedFlows.length) * 100) })} <span className="ca-badge observed">{T.cls('observed')} · {observedFlows[0]?.source}</span>{app.world.observedFlowMeta ? <small> · {T('insp.ago', { n: Math.round((now - app.world.observedFlowMeta.t) / 60000) })}</small> : null}</dd></>}
        {e.type === 'road' && (() => { const us = ((e.properties as RoadProperties).edgeIds ?? []).map((id) => app.world.observedUsual.get(id)).filter(Boolean); if (!us.length) return null; const u = us[0]!; return <><dt>{T('insp.usual')}</dt><dd>{u.usual === null ? T('insp.usual.none') : T('insp.usual.val', { n: Math.round(u.usual * 100), b: u.basis, s: u.samples })} <span className="ca-badge derived">{T.cls('derived')} · atlas.memory</span></dd></> })()}
        {e.type === 'incident' && <><dt>{T('insp.state')}</dt><dd>{now >= Number(e.properties.startTime) && now <= Number(e.properties.endTime) ? T('insp.active') : T('insp.inactive')} · {fmtT(Number(e.properties.startTime))} → {fmtT(Number(e.properties.endTime))}</dd></>}
        <dt>{T('insp.time')}</dt><dd>{fmtT(e.timestamp ?? e.evidence.timestamp)}</dd>
        <dt>{T('insp.source')}</dt><dd><span className={`ca-badge ${e.evidence.classification}`}>{T.cls(e.evidence.classification)}</span> {e.evidence.source}{e.evidence.model ? ` · ${e.evidence.model}` : ''}</dd>
        {e.evidence.confidence !== undefined && <><dt>{T('insp.conf')}</dt><dd>{Math.round(e.evidence.confidence * 100)}%</dd></>}
        {props.map(([k, v]) => <><dt key={k + 'k'}>{k}</dt><dd key={k + 'v'}>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</dd></>)}
      </dl>
      {related.length > 0 && <><h3>{T('insp.related', { m: 60, d: 60 })}</h3><div className="ca-events"><ul>{related.map((ev) => <li key={ev.id}><time>{fmtT(ev.timestamp)}</time>{ev.description}</li>)}</ul></div></>}
      {fc !== null && <><h3>{T('insp.prediction')}</h3><p style={{ margin: 0 }}><span className="ca-badge predicted">{T.cls('predicted')}</span> {T('insp.fc', { a: cong.toFixed(2), b: fc.toFixed(2), m: app.intel.state.forecast?.horizonsMin[fcIdx] ?? 0, c: Math.round((app.intel.state.forecast?.confidence[fcIdx] ?? 0) * 100) })}</p></>}
    </div>
  )
}
