import { useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { saveItem } from '../../app/saved'
import type { RouteAnswer } from '../../data/adapters/routeAdapter'
import { makeT } from '../i18n'
import { TierGate } from './TierGate'

interface Result { baseMin: number; closedMin: number; deltaMin: number; baseKm: number; closedKm: number; avoided: number[][]; model: string; noRoute: boolean }

/**
 * City Atlas Pro: the Scenario Lab. "Road closes" is real today: the closed area is removed from
 * the road network and the live routing engine (TomTom) re-routes the trip, so the extra minutes
 * come from a real router on real roads, labelled as a what-if. Metro openings and new
 * developments are listed as not modelled, because that needs calibrated demand data this city
 * does not have yet; nothing is invented to fill the gap.
 */
export function ScenarioPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const zones = app.zones.list()
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? '')
  const [res, setRes] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const trip = app.routeAnswer
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0]
  const run = async () => {
    if (!trip || !zone) return
    setBusy(true); setErr(null); setRes(null); setSaved(false)
    try {
      const ll = zone.ring.map((p) => app.lngLatOf(p))
      const box = [Math.min(...ll.map((p) => p.lng)), Math.min(...ll.map((p) => p.lat)), Math.max(...ll.map((p) => p.lng)), Math.max(...ll.map((p) => p.lat))].map((v) => v.toFixed(4)).join(',')
      const q = `from=${trip.from.lat},${trip.from.lng}&to=${trip.to.lat},${trip.to.lng}&alternatives=0`
      const r = await fetch(`${SERVER_BASE}/api/route?${q}&avoid=${box}`)
      if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
      const closed = (await r.json()) as RouteAnswer & { avoided: number[][] }
      const b = trip.routes[trip.recommended?.fastest ?? 0], c = closed.routes[0]
      if (!b || !c) { setRes({ baseMin: 0, closedMin: 0, deltaMin: 0, baseKm: 0, closedKm: 0, avoided: closed.avoided, model: closed.evidence.model ?? '', noRoute: true }); return }
      const baseMin = Math.round(b.travelTimeS / 60), closedMin = Math.round(c.travelTimeS / 60)
      setRes({ baseMin, closedMin, deltaMin: closedMin - baseMin, baseKm: Math.round(b.lengthM / 100) / 10, closedKm: Math.round(c.lengthM / 100) / 10, avoided: closed.avoided, model: closed.evidence.model ?? '', noRoute: false })
      app.showScenarioRoute(c.points)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const save = () => {
    if (!res || !trip || !zone) return
    saveItem({ kind: 'scenario', name: T('scn.saved.name', { z: zone.name }), lng: trip.from.lng, lat: trip.from.lat, score: null, data: { ...res, zone: zone.name, from: trip.from, to: trip.to } })
    setSaved(true)
  }
  return (
    <div className="ca-panel ca-side ca-scenario">
      <h3>{T('scn.title')}</h3>
      <TierGate app={app} feature="pro.scenario">
        <p className="note">{T('scn.help')}</p>
        <h4>{T('scn.close')}</h4>
        <ol className="ca-steps-list">
          <li>{trip ? <span>{T('scn.trip.ok', { a: `${trip.from.lat.toFixed(3)}, ${trip.from.lng.toFixed(3)}`, b: `${trip.to.lat.toFixed(3)}, ${trip.to.lng.toFixed(3)}` })}</span> : <span>{T('scn.trip.none')} <button className="small" onClick={() => app.requestTool('route')}>{T('tool.route')}</button></span>}</li>
          <li>{zones.length ? <span>{T('scn.zone.pick')} <select value={zone?.id ?? ''} onChange={(e) => setZoneId(e.target.value)}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></span> : <span>{T('scn.zone.none')} <button className="small" onClick={() => app.requestTool('zones')}>{T('tool.zones')}</button></span>}</li>
          <li><button className="primary" disabled={!trip || !zone || busy} onClick={() => void run()}>{busy ? '…' : T('scn.run')}</button></li>
        </ol>
        {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
        {res && (res.noRoute ? <p className="note">{T('scn.noroute')}</p> : <>
          <table className="ca-scn-table"><tbody>
            <tr><td /><td>{T('scn.before')}</td><td>{T('scn.after')}</td></tr>
            <tr><td>{T('route.time')}</td><td>{res.baseMin} min</td><td><b>{res.closedMin} min</b></td></tr>
            <tr><td>{T('route.distance')}</td><td>{res.baseKm} km</td><td><b>{res.closedKm} km</b></td></tr>
          </tbody></table>
          <p className="ca-scn-delta">{res.deltaMin > 0 ? T('scn.delta.more', { n: res.deltaMin }) : res.deltaMin < 0 ? T('scn.delta.less', { n: -res.deltaMin }) : T('scn.delta.same')}</p>
          <p className="note"><span className="ca-badge predicted">{T.cls('predicted')}</span> {res.model}</p>
          <div className="ca-row"><button className="small" disabled={saved} onClick={save}>{saved ? T('saved.done') : T('saved.add')}</button><button className="small" onClick={() => { setRes(null); app.clearScenarioRoute() }}>{T('sites.clear')}</button></div>
        </>)}
        <h4>{T('scn.notyet')}</h4>
        <ul className="ca-notyet">
          <li><b>{T('scn.metro')}</b> {T('scn.metro.why')}</li>
          <li><b>{T('scn.dev')}</b> {T('scn.dev.why')}</li>
          <li><b>{T('scn.signals')}</b> {T('scn.signals.why')}</li>
        </ul>
      </TierGate>
    </div>
  )
}
