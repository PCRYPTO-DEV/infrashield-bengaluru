import { useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { LayerFlags } from '../../rendering/layers/modes'
import { search } from '../../interaction/search/search'
import { makeT, type StringKey } from '../i18n'

const LAYER_KEYS: Array<keyof LayerFlags> = ['roads', 'buildings', 'labels', 'vehicles', 'pedestrians', 'signals', 'incidents', 'zones', 'uploads', 'flow', 'density', 'activity', 'anomalies', 'risk', 'predictions', 'forecast']

export function LayersPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  return (
    <div className="ca-panel ca-layers">
      <h3>{T('layers.title')}</h3>
      {LAYER_KEYS.map((k) => <label key={k}><span>{T(`layer.${k}` as StringKey)}</span><input type="checkbox" checked={app.layers[k]} onChange={() => app.toggleLayer(k)} /></label>)}
      {[...app.world.layers.values()].map((l) => (
        <label key={l.id}><span style={{ color: l.colour }}>◆ {l.name} ({l.entities.length})</span><span><input type="checkbox" checked={l.visible} onChange={() => app.toggleLayerVisible(l.id)} /><button className="small" onClick={() => app.removeLayer(l.id)}>×</button></span></label>
      ))}
    </div>
  )
}

export function PulsePanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const p = app.pulse
  if (!p) return <div className="ca-panel ca-side"><h3>{T('pulse.title')}</h3><p className="note">{T('pulse.wait')}</p></div>
  return (
    <div className="ca-panel ca-side">
      <h3>{T('pulse.title')}</h3>
      {p.categories.map((c) => (
        <div key={c.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{c.label}</b><span style={{ fontFamily: 'var(--mono)' }}>{c.index === null ? T('pulse.nodata') : `${Math.round(c.index * 100)} / 100`}</span></div>
          <div className="ca-meter"><i style={{ width: `${(c.index ?? 0) * 100}%`, opacity: c.index === null ? 0 : 1 }} /></div>
          <table><tbody>{c.measurements.map((m) => <tr key={m.label}><td>{m.label} <span className={`ca-badge ${m.evidence}`} style={{ fontSize: 8, padding: '0 4px' }}>{T.cls(m.evidence)}</span></td><td>{m.value}{m.unit ?? ''}</td></tr>)}</tbody></table>
          {c.note && <p className="note">{c.note}</p>}
        </div>
      ))}
    </div>
  )
}

export function ZonesPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const zones = app.zones.list()
  const events = app.zoneEvents.slice(-12).reverse()
  return (
    <div className="ca-panel ca-side">
      <h3>{T('zones.title')}</h3>
      <p className="note">{T('zones.help')}</p>
      <div className="ca-toolrow">
        {(['polygon', 'line', 'radius', 'corridor'] as const).map((k) => <button key={k} className={`ca-tool ${app.draw.state?.kind === k ? 'active' : ''}`} onClick={() => app.draw.start(k, 30 * app.world.unitPerMetre)}>{T(`zone.${k}` as StringKey)}</button>)}
      </div>
      {zones.length === 0 && <p className="note">{T('zones.none')}</p>}
      {zones.map((z) => {
        const st = app.zoneStats.get(z.id)
        return (
          <div key={z.id} style={{ borderTop: '1px dotted var(--hair)', paddingTop: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{z.name}</b><span><label style={{ fontSize: 10 }}>{T('zones.restricted')} <input type="checkbox" checked={z.restricted} onChange={(e) => app.setZoneRestricted(z.id, e.target.checked)} /></label><button className="small" onClick={() => app.removeZone(z.id)}>×</button></span></div>
            {st && <table><tbody>
              <tr><td>{T('zones.count')}</td><td>{st.count.vehicle} / {st.count.pedestrian}</td></tr>
              <tr><td>{T('zones.speed')}</td><td>{(st.meanSpeed * 3.6).toFixed(0)} km/h</td></tr>
              <tr><td>{T('zones.density')}</td><td>{st.density.toFixed(0)} /ha</td></tr>
              <tr><td>{T('zones.dwell')}</td><td>{Math.round(st.longestDwellS)} s</td></tr>
              <tr><td>{T('zones.direction')}</td><td>{st.direction.join(' ')}</td></tr>
            </tbody></table>}
          </div>
        )
      })}
      {events.length > 0 && <><h3 style={{ marginTop: 10 }}>{T('zones.events')}</h3><div className="ca-events"><ul>{events.map((e) => <li key={e.id}><time>{new Date(e.timestamp).toISOString().slice(11, 19)}</time>{e.description}</li>)}</ul></div></>}
    </div>
  )
}

export function RoutePanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const r = app.route
  const w = app.routeWeights
  const rows: Array<keyof typeof w> = ['travelTime', 'incidentRisk', 'congestion', 'pedestrianRisk', 'environmental']
  return (
    <div className="ca-panel ca-side">
      <h3>{T('route.title')}</h3>
      <p className="note">{T('route.help')}</p>
      <button className={`ca-tool ${app.draw.state?.kind === 'route' ? 'active' : ''}`} onClick={() => app.draw.start('route')}>{T('route.pick')}</button>
      {rows.map((k) => <div className="w" key={k}><span>{T(`route.w.${k}` as StringKey)}</span><input type="range" min={0} max={k === 'travelTime' ? 5 : 300} step={k === 'travelTime' ? 0.1 : 5} value={w[k]} onChange={(e) => app.setRouteWeights({ [k]: Number(e.target.value) })} /><span style={{ fontFamily: 'var(--mono)' }}>{w[k]}</span></div>)}
      {r && <>
        <table><tbody>
          <tr><td>{T('route.distance')}</td><td>{(r.distanceM / 1000).toFixed(2)} km</td></tr>
          <tr><td>{T('route.time')}</td><td>{Math.round(r.travelTimeS / 60)} min</td></tr>
          <tr><td>{T('route.inc')}</td><td>{r.factors.incidentRisk.toFixed(2)}</td></tr>
          <tr><td>{T('route.cong')}</td><td>{r.factors.congestion.toFixed(2)}</td></tr>
          <tr><td>{T('route.ped')}</td><td>{r.factors.pedestrianRisk.toFixed(2)}</td></tr>
        </tbody></table>
        {r.explanation.map((l, i) => <p className="note" key={i} style={{ margin: '4px 0' }}>{l}</p>)}
      </>}
    </div>
  )
}

export function UploadPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [msg, setMsg] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const onFile = async (f: File) => {
    try {
      if (f.size > 10 * 1024 * 1024) throw new Error(T('upload.toobig'))
      const text = await f.text()
      const r = app.addUpload(f.name, text, f.size)
      setMsg(`${T('upload.added', { n: r.entities })}${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`)
    } catch (e) { setMsg(T('upload.rejected', { m: (e as Error).message })) }
  }
  return (
    <div className="ca-panel ca-side">
      <h3>{T('upload.title')}</h3>
      <p className="note">{T('upload.help')} <span className="ca-badge observed">{T.cls('observed')}</span>.</p>
      <input ref={ref} type="file" accept=".geojson,.json,.csv,application/geo+json,application/json,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
      {msg && <p className="note">{msg}</p>}
    </div>
  )
}

export function SearchBox({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [q, setQ] = useState('')
  const results = q ? search(app.world, q) : []
  return (
    <div className="ca-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T('search.placeholder')} />
      {results.length > 0 && <ul>{results.map((r, i) => <li key={i} onClick={() => { app.select(r.selection); app.flyTo(r.point); setQ('') }}>{r.label}<small>{r.sub}</small></li>)}</ul>}
    </div>
  )
}
