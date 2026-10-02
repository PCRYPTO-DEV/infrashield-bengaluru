import { useEffect, useMemo, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { LayerFlags } from '../../rendering/layers/modes'
import { search, type SearchResult } from '../../interaction/search/search'
import { geocode, type GeoResult } from '../../data/adapters/routeAdapter'
import { SERVER_BASE } from '../../app/CityAtlas'
import { lngLatToLocal } from '../../geo/projection/frame'
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


/** Places anywhere in India as you type: 2 letters, 180 ms, the previous answer stays up while the next loads, stale answers are dropped, repeats are instant. */
const geoCache = new Map<string, GeoResult[]>()
export function useIndiaSearch(app: CityAtlas, q: string, enabled = true): { far: GeoResult[]; searching: boolean; settled: boolean } {
  const [far, setFar] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [settledFor, setSettledFor] = useState('')
  const seq = useRef(0)
  const key = q.trim().toLowerCase()
  useEffect(() => {
    if (!enabled || key.length < 2) { seq.current++; setFar([]); setSearching(false); setSettledFor(key); return }
    const hit = geoCache.get(key)
    if (hit) { seq.current++; setFar(hit); setSearching(false); setSettledFor(key); return }
    const id = ++seq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await geocode(SERVER_BASE, key, app.lngLatOf(app.camera.centre))
        if (id !== seq.current) return
        geoCache.set(key, r); setFar(r)
      } catch { if (id === seq.current) setFar([]) }
      finally { if (id === seq.current) { setSearching(false); setSettledFor(key) } }
    }, 180)
    return () => clearTimeout(t)
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { far, searching, settled: settledFor === key }
}

function PlaceInput({ app, value, onPick, placeholder, label }: { app: CityAtlas; value: PlacePick | null; onPick: (p: PlacePick | null) => void; placeholder: string; label: string }) {
  const T = makeT(app.language)
  const [q, setQ] = useState(value?.label ?? '')
  const [open, setOpen] = useState(false)
  const local = open && q && q !== value?.label ? search(app.world, q, 5) : []
  const { far, searching } = useIndiaSearch(app, q, open && q !== value?.label)
  const pickLocal = (r: SearchResult) => { setQ(r.label); setOpen(false); onPick({ label: r.label, point: r.point, lngLat: app.lngLatOf(r.point) }) }
  const pickFar = (g: GeoResult) => { setQ(g.name); setOpen(false); onPick({ label: g.name, point: lngLatToLocal(app.frame, { lng: g.lng, lat: g.lat }), lngLat: { lng: g.lng, lat: g.lat }, far: true }) }
  return (
    <label className="ca-place">
      <span>{label}</span>
      <span className="ca-search">
        <input value={q} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onPick(null) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {open && (local.length > 0 || far.length > 0 || searching || (q.length >= 2 && q !== value?.label)) && <ul>
          {local.map((r, i) => <li key={`l${i}`} onMouseDown={() => pickLocal(r)}>{r.label}<small>{r.sub}</small></li>)}
          {far.map((g, i) => <li key={`f${i}`} onMouseDown={() => pickFar(g)}>{g.name}<small>{g.address ?? g.town ?? ''} · {T('route.india')}</small></li>)}
          {searching && <li className="ca-nomatch">{T('route.searching')}</li>}
          {!searching && local.length === 0 && far.length === 0 && q.length >= 2 && q !== value?.label && <li className="ca-nomatch">{T('route.nomatch')}</li>}
        </ul>}
      </span>
    </label>
  )
}
type PlacePick = { label: string; point: { x: number; y: number }; lngLat: { lng: number; lat: number }; far?: boolean }

function fmtMin(s: number): string { return `${Math.round(s / 60)} min` }

export function RoutePanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const r = app.route
  const w = app.routeWeights
  const [from, setFrom] = useState<PlacePick | null>(null)
  const [to, setTo] = useState<PlacePick | null>(null)
  const [swapKey, setSwapKey] = useState(0)
  const rows: Array<keyof typeof w> = ['travelTime', 'incidentRisk', 'congestion', 'pedestrianRisk', 'environmental']
  const upm = app.world.unitPerMetre
  const go = () => {
    if (!from || !to) return
    const distM = Math.hypot(from.point.x - to.point.x, from.point.y - to.point.y) / upm
    // Beyond the streets loaded on screen (or a long hop): the country-wide router with live traffic.
    if (from.far || to.far || distM > 2500 || app.region.source === 'osm') void app.routeFar(from.lngLat, to.lngLat)
    else { app.setRouteEndpoints(from.point, to.point); app.flyTo({ x: (from.point.x + to.point.x) / 2, y: (from.point.y + to.point.y) / 2 }) }
  }
  const swap = () => { const a = from; setFrom(to); setTo(a); setSwapKey((k) => k + 1) }
  const ans = app.routeAnswer
  return (
    <div className="ca-panel ca-side ca-route">
      <h3>{T('route.title')}</h3>
      <p className="note">{T('route.help')}</p>
      <div className="ca-route-form" key={swapKey}>
        <PlaceInput app={app} value={from} onPick={setFrom} label={T('route.from')} placeholder={T('route.fromph')} />
        <PlaceInput app={app} value={to} onPick={setTo} label={T('route.to')} placeholder={T('route.toph')} />
        <div className="ca-row">
          <button className="primary" disabled={!from || !to || app.routeBusy} onClick={go}>{app.routeBusy ? '…' : T('route.go')}</button>
          <button className="small" onClick={swap}>⇅ {T('route.swap')}</button>
          {(r || ans) && <button className="small" onClick={() => app.clearRoute()}>{T('route.clear')}</button>}
        </div>
        {app.routeError && <p className="note" style={{ color: 'var(--risk)' }}>{app.routeError}</p>}
      </div>
      {ans && ans.routes.length > 0 && <div className="ca-route-options">
        {ans.routes.map((o, i) => {
          const tag = i === ans.recommended?.safer && i === ans.recommended?.fastest ? `${T('route.fastest')} · ${T('route.safer')}` : i === ans.recommended?.safer ? T('route.safer') : i === ans.recommended?.fastest ? T('route.fastest') : T('route.option', { n: i + 1 })
          return <button key={i} className={`ca-route-opt ${i === app.routeChoice ? 'active' : ''}`} onClick={() => app.chooseRoute(i)}>
            <b>{tag}</b><span>{fmtMin(o.travelTimeS)} · {(o.lengthM / 1000).toFixed(1)} km</span>
            <small>{T('route.delay', { n: Math.round((o.trafficDelayS || 0) / 60) })} · {T('route.incidents', { n: o.incidentsNear })}</small>
          </button>
        })}
        {ans.explanation?.map((l, i) => <p className="note" key={i} style={{ margin: '4px 0' }}>{l}</p>)}
        <p className="note"><span className="ca-badge derived">{T.cls('derived')}</span> {ans.source} · {T('route.live')}</p>
      </div>}
      {!ans && <button className={`ca-tool ${app.draw.state?.kind === 'route' ? 'active' : ''}`} onClick={() => app.draw.start('route')}>{T('route.pick')}</button>}
      {!ans && rows.map((k) => <div className="w" key={k}><span>{T(`route.w.${k}` as StringKey)}</span><input type="range" min={0} max={k === 'travelTime' ? 5 : 300} step={k === 'travelTime' ? 0.1 : 5} value={w[k]} onChange={(e) => app.setRouteWeights({ [k]: Number(e.target.value) })} /><span style={{ fontFamily: 'var(--mono)' }}>{w[k]}</span></div>)}
      {r && !ans && <>
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
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const local = useMemo(() => (q.trim() ? search(app.world, q, 6) : []), [app.world, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const { far, searching, settled } = useIndiaSearch(app, q, open)
  type Row = { key: string; label: string; sub: string; go: () => void }
  const rows = useMemo<Row[]>(() => [
    ...local.map((r, i) => ({ key: `l${i}`, label: r.label, sub: r.sub, go: () => { app.select(r.selection); app.flyTo(r.point) } })),
    ...far.filter((g) => !local.some((r) => r.label === g.name)).map((g, i) => ({ key: `f${i}`, label: g.name, sub: `${g.address ?? g.town ?? ''} · ${T('route.india')}`, go: () => app.goTo(g.lng, g.lat, g.kind === 'POI' || g.kind === 'Point Address' || g.kind === 'Street' || g.kind === 'Cross Street' ? 16.5 : 14.5, g.town ?? g.name) })),
  ], [local, far]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (r: Row) => { r.go(); setQ(''); setOpen(false); setCursor(0) }
  const empty = open && q.trim().length >= 2 && rows.length === 0 && !searching && settled
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); return }
    if (!rows.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % rows.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + rows.length) % rows.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[Math.min(cursor, rows.length - 1)]) }
  }
  return (
    <div className="ca-search" role="combobox" aria-expanded={open && (rows.length > 0 || empty)}>
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} placeholder={T('search.placeholder')} aria-autocomplete="list" />
      {open && (rows.length > 0 || empty || (searching && q.trim().length >= 2)) && <ul role="listbox">
        {rows.map((r, i) => <li key={r.key} role="option" aria-selected={i === cursor} className={i === cursor ? 'active' : ''} onMouseDown={() => pick(r)} onMouseEnter={() => setCursor(i)}>{r.label}<small>{r.sub}</small></li>)}
        {searching && rows.length === 0 && <li className="ca-nomatch">{T('route.searching')}</li>}
        {empty && <li className="ca-nomatch">{T('search.nomatch')}</li>}
      </ul>}
    </div>
  )
}
