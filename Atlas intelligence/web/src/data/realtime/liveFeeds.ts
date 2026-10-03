import type { UrbanEntity, IncidentProperties } from '../../entities/types'
import type { WorldModel } from '../../engine/world/WorldModel'
import type { WorldBounds, WorldPoint } from '../../geo/projection/mercator'
import type { LngLat } from '../../geo/coordinates/lngLat'
import { localToLngLat, lngLatToLocal } from '../../geo/projection/frame'
import { tilesInBounds, tileKey } from '../../geo/tiles/tiles'
import { pointToPolyline } from '../../geo/geometry'
import type { FeedStatus } from './feed'

/** One TomTom flow segment as the server returns it (lng/lat). */
export interface FlowSegment { id: string; coordinates: Array<[number, number]>; trafficLevel: number | null; roadCoverage?: string | null; roadType?: string | null }
export interface UsualReading { now: number; usual: number | null; samples: number; basis: string; delta: number | null }
export type AlertRule =
  | { kind: 'road_slow'; tile: string; segment: string | null; road: string; levelBelow: number; minutes: number }
  | { kind: 'count_above'; camera: string; what: 'people' | 'vehicles' | 'all'; above: number }
  | { kind: 'zone_event'; zone: string; events: string[] }
export interface AlertInput { name: string; channel: 'app' | 'sms' | 'whatsapp'; to: string; language: 'en' | 'hi'; rule: AlertRule }
export interface AlertRecord extends AlertInput { id: string; createdAt: number; lastFiredAt: number | null; enabled: boolean }
export interface MemorySummary { hours: number; flowReadings: number; segments: number; incidents: number; cameraCounts: number; cameras: number; peakPeople: number; peakVehicles: number; zoneEvents: number; memorySince: number | null; zoneEventsRecent: Array<{ t: number; zone: string; kind: string; description: string }> }
export interface FlowTile { key: string; fetchedAt: number; segments: FlowSegment[]; source: string }
export interface WeatherNow { fetchedAt: number; source: string; temperatureC: number | null; humidityPct: number | null; precipitationMm: number | null; windKmh: number | null; weatherCode: number | null; description: string | null; observedAt: string | null; evidence: { classification: 'observed'; source: string; timestamp: number; confidence: number } }

export const FLOW_TILE_ZOOM = 12

/**
 * Match observed flow segments onto the road graph. An edge takes a
 * segment's level when the edge midpoint lies within `toleranceM` of the
 * segment polyline and the headings agree within 35°. Both directions of a
 * two-way road receive the level (TomTom's relative tiles do not say which
 * side a 'one_side' segment covers, so this is a stated approximation).
 */
export function matchFlowToEdges(world: WorldModel, segments: FlowSegment[], toleranceM = 14, segmentOf?: Map<string, string>): Map<string, number> {
  const upm = world.unitPerMetre
  const tol = toleranceM * upm
  const out = new Map<string, number>()
  const graph = world.graph
  type Seg = { id: string; pts: WorldPoint[]; level: number; bounds: WorldBounds; heading: number }
  const segs: Seg[] = []
  for (const s of segments) {
    if (s.trafficLevel === null || s.coordinates.length < 2) continue
    const pts = s.coordinates.map((c) => lngLatToLocal(world.frame, { lng: c[0], lat: c[1] }))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
    const a = pts[0], b = pts[pts.length - 1]
    segs.push({ id: s.id, pts, level: s.trafficLevel, bounds: { minX: minX - tol, minY: minY - tol, maxX: maxX + tol, maxY: maxY + tol }, heading: Math.atan2(b.y - a.y, b.x - a.x) })
  }
  if (!segs.length) return out
  for (const e of graph.edges.values()) {
    const ep = graph.endpoints(e)
    if (!ep) continue
    const mid = { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 }
    const h = Math.atan2(ep.b.y - ep.a.y, ep.b.x - ep.a.x)
    let best: Seg | null = null, bd = tol
    for (const s of segs) {
      if (mid.x < s.bounds.minX || mid.x > s.bounds.maxX || mid.y < s.bounds.minY || mid.y > s.bounds.maxY) continue
      let dh = Math.abs(((h - s.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI)
      dh = Math.min(dh, Math.PI - dh) // either direction along the segment
      if (dh > (35 * Math.PI) / 180) continue
      const d = pointToPolyline(mid, s.pts)
      if (d < bd) { bd = d; best = s }
    }
    if (best) { out.set(e.id, best.level); segmentOf?.set(e.id, best.id) }
  }
  return out
}

/** Attach a live incident to the nearest road edge so the simulation queues behind it. */
export function attachIncidentToEdge(world: WorldModel, inc: UrbanEntity, toleranceM = 30): string {
  if (inc.geometry.type !== 'Point') return ''
  const p = lngLatToLocal(world.frame, { lng: inc.geometry.coordinates[0], lat: inc.geometry.coordinates[1] })
  const road = world.nearestRoad(p, toleranceM * world.unitPerMetre)
  if (!road) return ''
  const ids = (road.entity.properties as { edgeIds?: string[] }).edgeIds ?? []
  let best = '', bd = Infinity
  for (const id of ids) {
    const e = world.graph.edge(id); const ep = e && world.graph.endpoints(e)
    if (!e || !ep) continue
    const d = pointToPolyline(p, [ep.a, ep.b]); if (d < bd) { bd = d; best = id }
  }
  return best
}

export interface LiveFeedsOptions { baseUrl: string; flowIntervalMs?: number; incidentIntervalMs?: number; weatherIntervalMs?: number; fetchImpl?: typeof fetch }

/**
 * Polls the Atlas server for TomTom flow tiles and incidents covering the
 * viewport, plus Open-Meteo weather for the region. Results land in the
 * world model as observed data; the simulation is conditioned on them.
 */
export class LiveFeeds {
  status: Record<'flow' | 'incidents' | 'weather', FeedStatus> = { flow: 'idle', incidents: 'idle', weather: 'idle' }
  lastError: string | null = null
  callsToday = 0
  dailyBudget = 0
  private timers: ReturnType<typeof setInterval>[] = []
  private lastFlowKeys = ''
  /** the segments of the last successful poll, re-matched when streets arrive after the feed */
  private lastSegments: FlowSegment[] = []
  private lastSegmentsAt = 0
  /** edge id → TomTom segment id from the last match (for history and alerts) */
  edgeSegment = new Map<string, string>()
  /** While the time machine shows another instant, polls keep fetching but do not touch the world. */
  frozen = false
  /** Someone just reported something (SSE): the app refreshes the reports layer. */
  onReport: (() => void) | null = null
  private lastIncidents: UrbanEntity[] = []
  private lastUsualAt = 0
  private lastFlowAt = 0
  private lastIncidentAt = 0
  private view: WorldBounds | null = null
  private listeners = new Set<() => void>()
  private fetchImpl: typeof fetch

  constructor(private world: WorldModel, private opts: LiveFeedsOptions) { this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a)) }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private changed(): void { for (const l of this.listeners) l() }

  /** The server's live stream: every fresh reading arrives as an event and is applied at once; timers are only the fallback. */
  private stream: EventSource | null = null
  streamState: 'off' | 'open' | 'error' = 'off'
  private openStream(): void {
    const ES = (globalThis as unknown as { EventSource?: typeof EventSource }).EventSource
    if (!ES || this.stream) return
    try {
      const es = new ES(`${this.opts.baseUrl}/api/stream`)
      this.stream = es
      es.onopen = () => { this.streamState = 'open'; this.changed() }
      es.onerror = () => { this.streamState = 'error'; this.changed() }
      es.addEventListener('flow', (e) => this.onStreamEvent('flow', JSON.parse((e as MessageEvent).data)))
      es.addEventListener('incidents', (e) => this.onStreamEvent('incidents', JSON.parse((e as MessageEvent).data)))
      es.addEventListener('report', () => this.onReport?.())
    } catch { this.stream = null }
  }
  /** A reading just landed on the server: fetch it now (the server answers from its cache, so this is instant). */
  onStreamEvent(kind: string, msg: { tile?: string }): void {
    if (!this.view) return
    if (kind === 'flow' && msg.tile && this.flowKeys(this.view).includes(msg.tile)) void this.pollFlow(true)
    if (kind === 'incidents') void this.pollIncidents(true)
  }

  open(): void {
    this.status = { flow: 'connecting', incidents: 'connecting', weather: 'connecting' }
    this.openStream()
    this.timers.push(setInterval(() => void this.pollFlow(true), this.opts.flowIntervalMs ?? 60_000))
    this.timers.push(setInterval(() => void this.pollIncidents(true), this.opts.incidentIntervalMs ?? 60_000))
    this.timers.push(setInterval(() => void this.pollWeather(), this.opts.weatherIntervalMs ?? 600_000))
    this.timers.push(setInterval(() => void this.pollStatus(), 300_000))
    void this.pollWeather(); void this.pollStatus()
  }

  close(): void { for (const t of this.timers) clearInterval(t); this.timers = []; this.stream?.close(); this.stream = null; this.streamState = 'off'; this.status = { flow: 'closed', incidents: 'closed', weather: 'closed' }; this.changed() }

  /** Call on camera change; polls immediately when the covered tiles change. */
  setView(view: WorldBounds): void {
    this.view = view
    const keys = this.flowKeys(view).join(',')
    if (keys !== this.lastFlowKeys) { this.lastFlowKeys = keys; void this.pollFlow(false); void this.pollIncidents(false) }
  }

  private flowKeys(view: WorldBounds): string[] {
    const f = this.world.frame
    return tilesInBounds({ minX: view.minX + f.originX, minY: view.minY + f.originY, maxX: view.maxX + f.originX, maxY: view.maxY + f.originY }, FLOW_TILE_ZOOM, 0).map(tileKey).slice(0, 6)
  }

  async pollFlow(scheduled: boolean): Promise<void> {
    if (!this.view) return
    const now = Date.now()
    if (!scheduled && now - this.lastFlowAt < 15_000) return
    this.lastFlowAt = now
    try {
      const tiles = await Promise.all(this.flowKeys(this.view).map(async (k) => { const r = await this.fetchImpl(`${this.opts.baseUrl}/api/traffic/flow/${k}`); if (!r.ok) throw new Error(`flow ${k}: HTTP ${r.status}`); return (await r.json()) as FlowTile }))
      const segments = tiles.flatMap((t) => t.segments)
      this.lastSegments = segments; this.lastSegmentsAt = now
      const segmentOf = new Map<string, string>()
      const levels = matchFlowToEdges(this.world, segments, 14, segmentOf)
      this.edgeSegment = segmentOf
      if (!this.frozen) this.world.setObservedFlow(levels, now, 'tomtom', segments.length)
      this.status.flow = 'open'; this.lastError = null
      void this.pollUsual(tiles.map((t) => t.key))
    } catch (e) { this.status.flow = 'error'; this.lastError = (e as Error).message }
    this.changed()
  }

  /** Streets loaded after the last poll: match the cached segments onto them without another request. */
  rematch(): void {
    if (!this.lastSegments.length) return
    const segmentOf = new Map<string, string>()
    const levels = matchFlowToEdges(this.world, this.lastSegments, 14, segmentOf)
    if (this.frozen) { this.edgeSegment = segmentOf; return }
    if (levels.size !== this.world.observedFlow.size) { this.edgeSegment = segmentOf; this.world.setObservedFlow(levels, this.lastSegmentsAt, 'tomtom', this.lastSegments.length); this.applyUsual(); this.changed() }
  }

  /** Back to now: put the last live readings and incidents back on the map. */
  restore(): void {
    this.frozen = false
    const segmentOf = new Map<string, string>()
    const levels = matchFlowToEdges(this.world, this.lastSegments, 14, segmentOf)
    this.edgeSegment = segmentOf
    this.world.setObservedFlow(levels, this.lastSegmentsAt, 'tomtom', this.lastSegments.length)
    this.world.setLiveIncidents(this.lastIncidents)
    this.applyUsual(); this.changed()
    void this.pollFlow(true); void this.pollIncidents(true)
  }

  /** The city's memory: what each matched segment usually reads at this weekday and hour. */
  private usualBySegment = new Map<string, UsualReading>()
  async pollUsual(tileKeys: string[]): Promise<void> {
    const now = Date.now()
    if (now - this.lastUsualAt < 30_000) { this.applyUsual(); return }
    this.lastUsualAt = now
    try {
      const results = await Promise.all(tileKeys.map(async (k) => { const r = await this.fetchImpl(`${this.opts.baseUrl}/api/history/compare?tile=${k}`); return r.ok ? (await r.json()) as { segments: Record<string, UsualReading> } : null }))
      for (const res of results) if (res) for (const [seg, u] of Object.entries(res.segments)) this.usualBySegment.set(seg, u)
      this.applyUsual()
    } catch { /* memory is optional; the live reading still shows */ }
  }
  private applyUsual(): void {
    const byEdge = new Map<string, UsualReading & { segment: string }>()
    for (const [edge, seg] of this.edgeSegment) { const u = this.usualBySegment.get(seg); if (u) byEdge.set(edge, { ...u, segment: seg }) }
    this.world.setObservedUsual(byEdge)
  }

  // ---- what the app sends back into the memory ----
  private lastCameraPost = 0
  /** Camera counts, at most one every 10 s per camera. */
  postCamera(cameraId: string, people: number, vehicles: number, position: LngLat | null): void {
    const now = Date.now()
    if (now - this.lastCameraPost < 10_000) return
    this.lastCameraPost = now
    void this.fetchImpl(`${this.opts.baseUrl}/api/observations/camera`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cameraId, people, vehicles, lng: position?.lng, lat: position?.lat }) }).catch(() => {})
  }
  postZoneEvent(zone: string, kind: string, description: string, position: LngLat | null): void {
    void this.fetchImpl(`${this.opts.baseUrl}/api/observations/zone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zone, kind, description, lng: position?.lng, lat: position?.lat }) }).catch(() => {})
  }

  // ---- alerts (stored on the server) ----
  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await this.fetchImpl(`${this.opts.baseUrl}${path}`, { headers: { 'content-type': 'application/json' }, ...init })
    if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
    return (await r.json()) as T
  }
  listAlerts(): Promise<{ alerts: AlertRecord[]; delivery: { sms: boolean; whatsapp: boolean } }> { return this.api('/api/alerts') }
  createAlert(a: AlertInput): Promise<AlertRecord> { return this.api('/api/alerts', { method: 'POST', body: JSON.stringify(a) }) }
  deleteAlert(id: string): Promise<unknown> { return this.api(`/api/alerts/${id}`, { method: 'DELETE' }) }
  testAlert(id: string): Promise<{ message: string; delivered: string; detail: string }> { return this.api(`/api/alerts/${id}/test`, { method: 'POST' }) }
  alertLog(): Promise<{ log: Array<{ t: number; alertId: string; message: string; delivered: string; detail: string }> }> { return this.api('/api/alerts/log?limit=30') }
  memorySummary(): Promise<MemorySummary> { return this.api('/api/history/summary?hours=24') }

  async pollIncidents(scheduled: boolean): Promise<void> {
    if (!this.view) return
    const now = Date.now()
    if (!scheduled && now - this.lastIncidentAt < 15_000) return
    this.lastIncidentAt = now
    try {
      const f = this.world.frame
      const sw = localToLngLat(f, { x: this.view.minX, y: this.view.maxY }), ne = localToLngLat(f, { x: this.view.maxX, y: this.view.minY })
      const bbox = [sw.lng, sw.lat, ne.lng, ne.lat].map((v) => v.toFixed(3)).join(',')
      const r = await this.fetchImpl(`${this.opts.baseUrl}/api/traffic/incidents?bbox=${bbox}`)
      if (!r.ok) throw new Error(`incidents: HTTP ${r.status}`)
      const data = (await r.json()) as { entities: UrbanEntity[] }
      const entities = data.entities.map((e) => ({ ...e, properties: { ...(e.properties as IncidentProperties), edgeId: attachIncidentToEdge(this.world, e) } }))
      this.lastIncidents = entities
      if (!this.frozen) this.world.setLiveIncidents(entities)
      this.status.incidents = 'open'
    } catch (e) { this.status.incidents = 'error'; this.lastError = (e as Error).message }
    this.changed()
  }

  async pollWeather(): Promise<void> {
    try {
      const ll = localToLngLat(this.world.frame, { x: 0, y: 0 })
      const r = await this.fetchImpl(`${this.opts.baseUrl}/api/weather?lat=${ll.lat.toFixed(3)}&lng=${ll.lng.toFixed(3)}`)
      if (!r.ok) throw new Error(`weather: HTTP ${r.status}`)
      this.world.weather = (await r.json()) as WeatherNow
      this.status.weather = 'open'
    } catch (e) { this.status.weather = 'error'; this.lastError = (e as Error).message }
    this.changed()
  }

  async pollStatus(): Promise<void> {
    try { const r = await this.fetchImpl(`${this.opts.baseUrl}/api/traffic/status`); if (r.ok) { const s = await r.json(); this.callsToday = s.callsToday; this.dailyBudget = s.dailyBudget } } catch { /* optional */ }
    this.changed()
  }
}
