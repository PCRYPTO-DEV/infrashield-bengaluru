import { useEffect, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { Prediction } from '../../intelligence/types'
import type { RoadProperties } from '../../entities/types'
import { localToLngLat } from '../../geo/projection/frame'

const SKIP = new Set(['edgeIds', 'osm'])
const fmtT = (ts?: number) => (ts ? new Date(ts).toISOString().slice(11, 19) + ' UTC' : '—')

/** ENTITY · TYPE · STATE · TIME · SOURCE · CONFIDENCE · HISTORY · RELATED EVENTS · PREDICTION. Fields appear only when they exist. */
export function InspectorPanel({ app }: { app: CityAtlas }) {
  const sel = app.selection
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
    if (!a) return <div className="ca-panel ca-inspector"><h3>Entity</h3><p>Agent #{sel.id} left the loaded area.</p><button className="close" onClick={() => app.select(null)}>×</button></div>
    const edge = app.world.graph.edge(a.edgeId)
    const road = edge && app.world.entities.get(edge.roadId)
    const roadName = (road?.entity.properties as RoadProperties | undefined)?.name
    const ll = localToLngLat(app.frame, a)
    const anomalies = app.intel.state.anomalies.filter((x) => x.entityIds.includes(`agent:${a.id}`))
    const related = app.memory.near(a, 80 * upm, now - 30 * 60000, now).slice(0, 6)
    const hist = a.history.slice(-24)
    const maxS = Math.max(0.1, ...hist.map((h) => h.speed))
    return (
      <div className="ca-panel ca-inspector">
        <button className="close" onClick={() => app.select(null)}>×</button>
        <h3>Entity</h3>
        <dl>
          <dt>Entity</dt><dd>{a.kind} #{a.id}</dd>
          <dt>Type</dt><dd>{a.kind}</dd>
          <dt>State</dt><dd>{a.speed < 0.3 ? 'stopped' : 'moving'} · {(a.speed / upm).toFixed(1)} m/s ({((a.speed / upm) * 3.6).toFixed(0)} km/h) · heading {Math.round(((a.heading * 180) / Math.PI + 360) % 360)}°</dd>
          {roadName && <><dt>On</dt><dd>{roadName} <small>({edge?.roadClass})</small></dd></>}
          <dt>Position</dt><dd>{ll.lat.toFixed(5)}, {ll.lng.toFixed(5)}</dd>
          <dt>Time</dt><dd>{fmtT(a.lastSeen)}</dd>
          <dt>Source</dt><dd><span className={`ca-badge ${a.evidence.classification}`}>{a.evidence.classification}</span> {a.evidence.source}</dd>
          {a.evidence.confidence !== undefined && <><dt>Confidence</dt><dd>{Math.round(a.evidence.confidence * 100)}%</dd></>}
        </dl>
        {hist.length > 1 && <><h3>History · speed, last {hist.length} samples</h3><div className="ca-spark">{hist.map((h, i) => <i key={i} style={{ height: `${(h.speed / maxS) * 100}%` }} />)}</div></>}
        {anomalies.length > 0 && <><h3>Anomalies</h3><div className="ca-events"><ul>{anomalies.map((x) => <li key={x.id}><b>{x.type.replace('_', ' ')}</b> — {x.explanation} <small>{x.evidence.join('; ')}</small></li>)}</ul></div></>}
        {related.length > 0 && <><h3>Related events · 30 min, 80 m</h3><div className="ca-events"><ul>{related.map((e) => <li key={e.id}><time>{fmtT(e.timestamp)}</time>{e.description}</li>)}</ul></div></>}
        {pred && <><h3>Prediction</h3><p style={{ margin: 0 }}><span className="ca-badge predicted">predicted</span> {pred.method}, horizon {pred.horizonS} s, confidence {Math.round(pred.confidence * 100)}%. Envelope grows to ±{Math.round(pred.envelope[pred.envelope.length - 1] / upm)} m. {pred.alternatives.length ? `${pred.alternatives.length} alternative branch(es).` : ''}</p></>}
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
  const count = flows.reduce((s, f) => s + (f?.count ?? 0), 0)
  const cong = flows.length ? flows.reduce((s, f) => s + (f?.congestion ?? 0), 0) / flows.length : 0
  const forecast = e.type === 'road' ? ((e.properties as RoadProperties).edgeIds ?? []).map((id) => app.intel.state.forecast?.edges.get(id)).filter(Boolean) : []
  const fcIdx = (app.intel.state.forecast?.horizonsMin.length ?? 1) - 1
  const fc = forecast.length ? forecast.reduce((s, v) => s + (v?.[fcIdx] ?? 0), 0) / forecast.length : null
  return (
    <div className="ca-panel ca-inspector">
      <button className="close" onClick={() => app.select(null)}>×</button>
      <h3>Entity</h3>
      <dl>
        <dt>Entity</dt><dd>{String(e.properties.name ?? e.id)}</dd>
        <dt>Type</dt><dd>{e.type}</dd>
        {e.type === 'road' && flows.length > 0 && <><dt>State</dt><dd>{count} vehicles · congestion {cong.toFixed(2)} <span className="ca-badge derived">derived</span></dd></>}
        {e.type === 'incident' && <><dt>State</dt><dd>{now >= Number(e.properties.startTime) && now <= Number(e.properties.endTime) ? 'active' : 'inactive'} · {fmtT(Number(e.properties.startTime))} → {fmtT(Number(e.properties.endTime))}</dd></>}
        <dt>Time</dt><dd>{fmtT(e.timestamp ?? e.evidence.timestamp)}</dd>
        <dt>Source</dt><dd><span className={`ca-badge ${e.evidence.classification}`}>{e.evidence.classification}</span> {e.evidence.source}{e.evidence.model ? ` · ${e.evidence.model}` : ''}</dd>
        {e.evidence.confidence !== undefined && <><dt>Confidence</dt><dd>{Math.round(e.evidence.confidence * 100)}%</dd></>}
        {props.map(([k, v]) => <><dt key={k + 'k'}>{k}</dt><dd key={k + 'v'}>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</dd></>)}
      </dl>
      {related.length > 0 && <><h3>Related events · 60 min, 60 m</h3><div className="ca-events"><ul>{related.map((ev) => <li key={ev.id}><time>{fmtT(ev.timestamp)}</time>{ev.description}</li>)}</ul></div></>}
      {fc !== null && <><h3>Prediction</h3><p style={{ margin: 0 }}><span className="ca-badge predicted">predicted</span> congestion {cong.toFixed(2)} → {fc.toFixed(2)} in +{app.intel.state.forecast?.horizonsMin[fcIdx]} min (confidence {Math.round((app.intel.state.forecast?.confidence[fcIdx] ?? 0) * 100)}%)</p></>}
    </div>
  )
}
