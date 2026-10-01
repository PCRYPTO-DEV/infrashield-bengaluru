import { useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { LayerFlags } from '../../rendering/layers/modes'
import { search } from '../../interaction/search/search'

const LAYER_LABELS: Array<[keyof LayerFlags, string]> = [
  ['roads', 'Roads'], ['buildings', 'Buildings'], ['labels', 'Street labels'], ['vehicles', 'Vehicles'], ['pedestrians', 'Pedestrians'], ['signals', 'Signal phases'],
  ['incidents', 'Incidents'], ['zones', 'Zones'], ['uploads', 'Uploaded layers'], ['flow', 'Traffic flow (derived)'], ['density', 'Density (derived)'], ['activity', 'Activity pulses (derived)'],
  ['anomalies', 'Anomalies (derived)'], ['risk', 'Risk contours (derived)'], ['predictions', 'Predicted paths'], ['forecast', 'Congestion forecast'],
]

export function LayersPanel({ app }: { app: CityAtlas }) {
  return (
    <div className="ca-panel ca-layers">
      <h3>Layers</h3>
      {LAYER_LABELS.map(([k, label]) => <label key={k}><span>{label}</span><input type="checkbox" checked={app.layers[k]} onChange={() => app.toggleLayer(k)} /></label>)}
      {[...app.world.layers.values()].map((l) => (
        <label key={l.id}><span style={{ color: l.colour }}>◆ {l.name} ({l.entities.length})</span><span><input type="checkbox" checked={l.visible} onChange={() => app.toggleLayerVisible(l.id)} /><button className="small" onClick={() => app.removeLayer(l.id)}>×</button></span></label>
      ))}
    </div>
  )
}

export function PulsePanel({ app }: { app: CityAtlas }) {
  const p = app.pulse
  if (!p) return <div className="ca-panel ca-side"><h3>City pulse</h3><p className="note">Waiting for the first analytics pass…</p></div>
  return (
    <div className="ca-panel ca-side">
      <h3>City pulse</h3>
      {p.categories.map((c) => (
        <div key={c.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{c.label}</b><span style={{ fontFamily: 'var(--mono)' }}>{c.index === null ? 'no data' : c.index.toFixed(2)}</span></div>
          <div className="ca-meter"><i style={{ width: `${(c.index ?? 0) * 100}%`, opacity: c.index === null ? 0 : 1 }} /></div>
          <table><tbody>{c.measurements.map((m) => <tr key={m.label}><td>{m.label} <span className={`ca-badge ${m.evidence}`} style={{ fontSize: 8, padding: '0 4px' }}>{m.evidence}</span></td><td>{m.value}{m.unit ?? ''}</td></tr>)}</tbody></table>
          {c.note && <p className="note">{c.note}</p>}
        </div>
      ))}
    </div>
  )
}

export function ZonesPanel({ app }: { app: CityAtlas }) {
  const zones = app.zones.list()
  const events = app.zoneEvents.slice(-12).reverse()
  return (
    <div className="ca-panel ca-side">
      <h3>Monitoring zones</h3>
      <p className="note">Draw: polygon (click points, Enter/double-click to finish), line, radius (centre then edge), corridor.</p>
      <div className="ca-toolrow">
        {(['polygon', 'line', 'radius', 'corridor'] as const).map((k) => <button key={k} className={`ca-tool ${app.draw.state?.kind === k ? 'active' : ''}`} onClick={() => app.draw.start(k, 30 * app.world.unitPerMetre)}>{k}</button>)}
      </div>
      {zones.length === 0 && <p className="note">No zones yet.</p>}
      {zones.map((z) => {
        const st = app.zoneStats.get(z.id)
        return (
          <div key={z.id} style={{ borderTop: '1px dotted var(--hair)', paddingTop: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{z.name}</b><span><label style={{ fontSize: 10 }}>restricted <input type="checkbox" checked={z.restricted} onChange={(e) => app.setZoneRestricted(z.id, e.target.checked)} /></label><button className="small" onClick={() => app.removeZone(z.id)}>×</button></span></div>
            {st && <table><tbody>
              <tr><td>Vehicles / pedestrians</td><td>{st.count.vehicle} / {st.count.pedestrian}</td></tr>
              <tr><td>Mean speed</td><td>{st.meanSpeed.toFixed(1)} m/s</td></tr>
              <tr><td>Density</td><td>{st.density.toFixed(0)} /ha</td></tr>
              <tr><td>Longest dwell</td><td>{Math.round(st.longestDwellS)} s</td></tr>
              <tr><td>Direction (E,SE,S,SW,W,NW,N,NE)</td><td>{st.direction.join(' ')}</td></tr>
            </tbody></table>}
          </div>
        )
      })}
      {events.length > 0 && <><h3 style={{ marginTop: 10 }}>Zone events</h3><div className="ca-events"><ul>{events.map((e) => <li key={e.id}><time>{new Date(e.timestamp).toISOString().slice(11, 19)}</time>{e.description}</li>)}</ul></div></>}
    </div>
  )
}

export function RoutePanel({ app }: { app: CityAtlas }) {
  const r = app.route
  const w = app.routeWeights
  const rows: Array<[keyof typeof w, string]> = [['travelTime', 'α travel time'], ['incidentRisk', 'β incident risk'], ['congestion', 'γ congestion'], ['pedestrianRisk', 'δ pedestrian risk'], ['environmental', 'ε environmental']]
  return (
    <div className="ca-panel ca-side">
      <h3>Route · lower estimated risk</h3>
      <p className="note">Click start and end on the map. Cost = α·time + β·incident + γ·congestion + δ·pedestrian + ε·environment.</p>
      <button className={`ca-tool ${app.draw.state?.kind === 'route' ? 'active' : ''}`} onClick={() => app.draw.start('route')}>Pick endpoints</button>
      {rows.map(([k, label]) => <div className="w" key={k}><span>{label}</span><input type="range" min={0} max={k === 'travelTime' ? 5 : 300} step={k === 'travelTime' ? 0.1 : 5} value={w[k]} onChange={(e) => app.setRouteWeights({ [k]: Number(e.target.value) })} /><span style={{ fontFamily: 'var(--mono)' }}>{w[k]}</span></div>)}
      {r && <>
        <table><tbody>
          <tr><td>Distance</td><td>{(r.distanceM / 1000).toFixed(2)} km</td></tr>
          <tr><td>Est. travel time</td><td>{Math.round(r.travelTimeS / 60)} min</td></tr>
          <tr><td>Incident exposure</td><td>{r.factors.incidentRisk.toFixed(2)}</td></tr>
          <tr><td>Congestion exposure</td><td>{r.factors.congestion.toFixed(2)}</td></tr>
          <tr><td>Pedestrian exposure</td><td>{r.factors.pedestrianRisk.toFixed(2)}</td></tr>
        </tbody></table>
        {r.explanation.map((l, i) => <p className="note" key={i} style={{ margin: '4px 0' }}>{l}</p>)}
      </>}
    </div>
  )
}

export function UploadPanel({ app }: { app: CityAtlas }) {
  const [msg, setMsg] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const onFile = async (f: File) => {
    try {
      if (f.size > 10 * 1024 * 1024) throw new Error('file exceeds the 10 MB limit')
      const text = await f.text()
      const r = app.addUpload(f.name, text, f.size)
      setMsg(`Added ${r.entities} entities as an observed layer.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`)
    } catch (e) { setMsg(`Rejected: ${(e as Error).message}`) }
  }
  return (
    <div className="ca-panel ca-side">
      <h3>Upload dataset</h3>
      <p className="note">GeoJSON, JSON records or CSV with lat/lng columns, up to 10 MB. Files are validated and parsed only; nothing is executed. Uploaded objects become an <span className="ca-badge observed">observed</span> layer.</p>
      <input ref={ref} type="file" accept=".geojson,.json,.csv,application/geo+json,application/json,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
      {msg && <p className="note">{msg}</p>}
    </div>
  )
}

export function SearchBox({ app }: { app: CityAtlas }) {
  const [q, setQ] = useState('')
  const results = q ? search(app.world, q) : []
  return (
    <div className="ca-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roads, places, #agent" />
      {results.length > 0 && <ul>{results.map((r, i) => <li key={i} onClick={() => { app.select(r.selection); app.flyTo(r.point); setQ('') }}>{r.label}<small>{r.sub}</small></li>)}</ul>}
    </div>
  )
}
