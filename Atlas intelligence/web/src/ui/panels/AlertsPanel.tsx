import { useEffect, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { AlertRecord, AlertRule, MemorySummary } from '../../data/realtime/liveFeeds'
import { makeT, type StringKey } from '../i18n'

type Kind = AlertRule['kind']

/**
 * "Tell me when…": alert rules kept on the server and delivered by WhatsApp
 * or SMS in plain words. Also shows what the city remembers so far.
 */
export function AlertsPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const feeds = app.feeds
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [delivery, setDelivery] = useState<{ sms: boolean; whatsapp: boolean } | null>(null)
  const [log, setLog] = useState<Array<{ t: number; message: string; delivered: string }>>([])
  const [memory, setMemory] = useState<MemorySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('road_slow')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<'app' | 'sms' | 'whatsapp'>('app')
  const [to, setTo] = useState('')
  const [road, setRoad] = useState<{ segment: string; roadName: string; tile: string } | null>(null)
  const [levelBelow, setLevelBelow] = useState(50)
  const [minutes, setMinutes] = useState(10)
  const [what, setWhat] = useState<'people' | 'vehicles' | 'all'>('people')
  const [above, setAbove] = useState(50)
  const [zone, setZone] = useState('')

  const refresh = async () => {
    if (!feeds) return
    try {
      const [a, l, m] = await Promise.all([feeds.listAlerts(), feeds.alertLog(), feeds.memorySummary()])
      setAlerts(a.alerts); setDelivery(a.delivery); setLog(l.log); setMemory(m); setError(null)
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void refresh() }, [feeds]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!feeds) return <div className="ca-panel ca-side ca-alerts"><h3>{T('alerts.title')}</h3><p className="note">{T('alerts.offline')}</p></div>

  const pickRoad = () => app.pickMapPoint(T('alerts.pickroad.hint'), (p) => { const r = app.nearestObservedEdge(p); if (r) { setRoad(r); if (!name) setName(r.roadName) } else setError(T('alerts.noroad')) })

  const create = async () => {
    let rule: AlertRule
    if (kind === 'road_slow') { if (!road) { setError(T('alerts.noroad')); return } rule = { kind, tile: road.tile, segment: road.segment, road: road.roadName, levelBelow: levelBelow / 100, minutes } }
    else if (kind === 'count_above') rule = { kind, camera: app.vision.cameraId, what, above }
    else { if (!zone) return; rule = { kind, zone, events: ['count', 'dwell', 'density', 'entry'] } }
    try { await feeds.createAlert({ name: name || T(`alerts.kind.${kind}` as StringKey), channel, to, language: app.language, rule }); setName(''); setRoad(null); await refresh() } catch (e) { setError((e as Error).message) }
  }
  const zones = app.zones.list()

  return (
    <div className="ca-panel ca-side ca-alerts">
      <h3>{T('alerts.title')}</h3>
      <p className="note">{T('alerts.help')}</p>
      <div className="ca-kinds">{(['road_slow', 'count_above', 'zone_event'] as Kind[]).map((k) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{T(`alerts.kind.${k}` as StringKey)}</button>)}</div>
      {kind === 'road_slow' && <div className="ca-form">
        <button className="ghost" onClick={pickRoad}>{road ? road.roadName : T('alerts.pickroad')}</button>
        <label>{T('alerts.slower', { n: levelBelow })}<input type="range" min={10} max={90} step={5} value={levelBelow} onChange={(e) => setLevelBelow(Number(e.target.value))} /></label>
        <label>{T('alerts.for', { n: minutes })}<input type="range" min={1} max={60} step={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
      </div>}
      {kind === 'count_above' && <div className="ca-form">
        <label>{T('alerts.camera')} <span style={{ fontFamily: 'var(--mono)' }}>{app.vision.cameraId}</span></label>
        <label>{T('alerts.above')} <input type="number" min={1} value={above} onChange={(e) => setAbove(Number(e.target.value) || 1)} /> <select value={what} onChange={(e) => setWhat(e.target.value as typeof what)}>{(['people', 'vehicles', 'all'] as const).map((w) => <option key={w} value={w}>{T(`alerts.what.${w}` as StringKey)}</option>)}</select></label>
      </div>}
      {kind === 'zone_event' && <div className="ca-form">
        <label>{T('alerts.zone')} <select value={zone} onChange={(e) => setZone(e.target.value)}><option value="">…</option>{zones.map((z) => <option key={z.id} value={z.name}>{z.name}</option>)}</select></label>
        {zones.length === 0 && <p className="note">{T('zones.none')}</p>}
      </div>}
      <div className="ca-form">
        <label>{T('alerts.name')} <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label>{T('alerts.channel')} <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}><option value="app">{T('alerts.channel.app')}</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select></label>
        {channel !== 'app' && <label>{T('alerts.phone')} <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+91" maxLength={20} /></label>}
        <button onClick={() => void create()}>{T('alerts.create')}</button>
      </div>
      {delivery && !delivery.sms && !delivery.whatsapp && <p className="note">{T('alerts.delivery.none')}</p>}
      {error && <p className="note" style={{ color: 'var(--risk)' }}>{error}</p>}

      <h3 style={{ marginTop: 10 }}>{T('alerts.yours')}</h3>
      {alerts.length === 0 && <p className="note">{T('alerts.none')}</p>}
      {alerts.map((a) => (
        <div key={a.id} className="ca-alert">
          <div><b>{a.name}</b> <small>· {T(`alerts.kind.${a.rule.kind}` as StringKey)} · {a.channel === 'app' ? T('alerts.channel.app') : `${a.channel} ${a.to}`}</small></div>
          <div><button className="small" onClick={() => void feeds.testAlert(a.id).then(refresh).catch((e) => setError((e as Error).message))}>{T('alerts.test')}</button> <button className="small" onClick={() => void feeds.deleteAlert(a.id).then(refresh)}>×</button></div>
        </div>
      ))}
      {log.length > 0 && <><h3 style={{ marginTop: 10 }}>{T('alerts.log')}</h3><div className="ca-events"><ul>{log.map((l, i) => <li key={i}><time>{new Date(l.t).toISOString().slice(11, 16)}</time>{l.message} <small>({l.delivered})</small></li>)}</ul></div></>}

      <h3 style={{ marginTop: 10 }}>{T('memory.title')}</h3>
      {memory && memory.flowReadings + memory.cameraCounts + memory.zoneEvents > 0
        ? <p className="note">{T('memory.line', { r: memory.flowReadings, s: memory.segments, c: memory.cameraCounts, z: memory.zoneEvents })} {memory.memorySince ? T('memory.since', { d: new Date(memory.memorySince).toISOString().slice(0, 10) }) : ''}</p>
        : <p className="note">{T('memory.empty')}</p>}
    </div>
  )
}
