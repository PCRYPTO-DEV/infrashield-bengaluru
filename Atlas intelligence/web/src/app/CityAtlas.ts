import { createFrame, type WorldFrame } from '../geo/projection/frame'
import { lngLatToLocal } from '../geo/projection/frame'
import { CityChunkManager } from '../engine/chunks/CityChunkManager'
import { WorldModel } from '../engine/world/WorldModel'
import { TemporalEngine, type TemporalState } from '../engine/simulation/temporalEngine'
import { DATASET_VERSION } from '../engine/seed/worldSeed'
import { DISTRICT_ZOOM } from '../engine/procedural/generateDistrict'
import { WorldGenerationClient } from '../workers/WorldGenerationClient'
import { SimulationClient } from '../workers/SimulationClient'
import { IntelligencePipeline } from '../intelligence/pipeline'
import { ZoneEngine } from '../zones/zoneEngine'
import type { ZoneEvent, ZoneRule, ZoneShape, ZoneStats } from '../zones/types'
import { UrbanMemory } from '../intelligence/memory/urbanMemory'
import { Camera } from '../interaction/camera/Camera'
import { CompositeRenderer } from '../rendering/CompositeRenderer'
import { LodController } from '../rendering/lod'
import { modeDefaults, type LayerFlags, type ViewMode } from '../rendering/layers/modes'
import type { WorldState } from '../rendering/CityRenderer'
import { hitTest, type Selection } from '../interaction/selection/hitTest'
import { ZoneDrawTool } from '../interaction/drawing/ZoneDrawTool'
import { routeBetween, nearestNode, type RouteResult, type RouteWeights, DEFAULT_WEIGHTS } from '../intelligence/routing/saferRouter'
import { askTheCity } from '../intelligence/reasoning/askTheCity'
import type { Answer } from '../intelligence/reasoning/evidence'
import type { ChunkData } from '../engine/world/chunkTypes'
import type { IncidentProperties, UrbanEntity } from '../entities/types'
import type { WorldPoint } from '../geo/projection/mercator'
import { cityPulse, type CityPulseReport } from '../intelligence/pulse/cityPulse'
import { parseUploadedText } from '../data/adapters/uploadedDatasetAdapter'
import { featuresToEntities } from '../data/adapters/geoJsonAdapter'
import type { SimSnapshot } from '../engine/simulation/snapshot'
import { REGIONS, DEFAULT_REGION, type Region } from './regions'
import { LiveFeeds } from '../data/realtime/liveFeeds'
import { SnapshotRecorder } from '../engine/simulation/snapshotRecorder'
import { inkDocument } from '../rendering/svg/inkSvg'
import { ClaudeExplainer, type Language } from '../intelligence/reasoning/claudeExplainer'
import type { EvidenceItem } from '../intelligence/reasoning/evidence'
import { weakest } from '../intelligence/reasoning/evidence'
import type { RoadProperties } from '../entities/types'
import { VisionSession } from '../cv/vision/VisionSession'
import type { TrackObservation } from '../cv/pipeline'
import { renderCameraScene, poseFromPoints, type VisionFrame } from '../rendering/svg/visionSvg'
import type { LngLat } from '../geo/coordinates/lngLat'
import { localToLngLat } from '../geo/projection/frame'
import type { AgentView } from '../engine/world/WorldModel'
import { deriveInsights, type Insight } from '../intelligence/insights/insightEngine'
import { fetchPlace, fetchChanges, type PlaceState, type ChangeReport } from '../data/adapters/placeAdapter'
import { routeBetween as serverRoute, type RouteAnswer, type RouteOption } from '../data/adapters/routeAdapter'
import { loadTier, saveTier, unlockWithPassword, hasFeature, type Tier, type Feature } from './tiers'
import { tr, type StringKey } from '../ui/i18n'
import type { IntelligenceState } from '../intelligence/types'

export type Theme = 'day' | 'night'
export type ToolName = 'layers' | 'zones' | 'route' | 'upload' | 'pulse' | 'camera' | 'alerts' | 'insights'

export const DEFAULT_SEED = REGIONS[DEFAULT_REGION].seed
/** Base URL of the Atlas server; empty means same origin (Vite proxies /api in dev). */
export const SERVER_BASE = (import.meta.env?.VITE_ATLAS_SERVER as string | undefined) ?? ''

export interface AppStats { fps: number; frameMs: number; agents: number; chunks: number; inFlight: number; simStepMs: number; intelMs: number; simLagS: number }

/**
 * CityAtlas: the composition root. Owns every engine, runs the frame loop,
 * and exposes a tiny external store for React (which only renders UI).
 */
export class CityAtlas {
  readonly frame: WorldFrame
  readonly seed: string
  readonly region: Region
  readonly temporal: TemporalEngine
  readonly world: WorldModel
  readonly chunks: CityChunkManager
  /** City-scale tier: cheap district tiles that cover everything the street tier cannot afford. */
  readonly districts: CityChunkManager
  readonly sim: SimulationClient
  readonly intel: IntelligencePipeline
  readonly zones: ZoneEngine
  readonly memory: UrbanMemory
  readonly camera: Camera
  readonly draw = new ZoneDrawTool()
  readonly recorder = new SnapshotRecorder(2000, 300)
  /** Live feeds (TomTom flow + incidents, Open-Meteo weather); null for procedural regions. */
  readonly feeds: LiveFeeds | null
  readonly lodController = new LodController(20)
  renderer: CompositeRenderer | null = null
  private gen: WorldGenerationClient

  mode: ViewMode = 'reality'
  layers: LayerFlags = modeDefaults('reality')
  selection: Selection | null = null
  hover: Selection | null = null
  highlights: WorldState['highlights'] = { points: [], entityIds: [], agentIds: [] }
  route: RouteResult | null = null
  routePick: WorldPoint[] = []
  routeWeights: RouteWeights = { ...DEFAULT_WEIGHTS }
  lastAnswer: Answer | null = null
  zoneEvents: ZoneEvent[] = []
  zoneStats = new Map<string, ZoneStats>()
  pulse: CityPulseReport | null = null
  stats: AppStats = { fps: 0, frameMs: 0, agents: 0, chunks: 0, inFlight: 0, simStepMs: 0, intelMs: 0, simLagS: 0 }

  readonly districtNames = new Map<string, string>()
  private realSources: { street: WorldGenerationClient | null; district: WorldGenerationClient | null } = { street: null, district: null }
  /** How many real-data tiles fell back to the procedural city (0 when the region is procedural). */
  get realDataFallbacks(): number { return (this.realSources.street?.fallbacks ?? 0) + (this.realSources.district?.fallbacks ?? 0) }
  /** Why the last real-data tile failed (server reason included), or null. */
  get realDataError(): string | null { return this.realSources.street?.lastError ?? this.realSources.district?.lastError ?? null }
  private lastCameraVersion = -1
  private lastReconcile = 0
  private raf = 0
  private lastFrame = 0
  private lastIntel = 0
  private fpsAcc = 0
  private fpsN = 0
  private version = 0
  private listeners = new Set<() => void>()
  private disposed = false

  constructor(seed?: string, region: Region = REGIONS[DEFAULT_REGION], startTime = Date.now()) {
    this.region = region
    this.seed = seed || region.seed
    this.frame = createFrame(region.origin)
    this.temporal = new TemporalEngine(startTime)
    this.world = new WorldModel(this.frame)
    this.gen = new WorldGenerationClient()
    const real = region.source === 'osm'
    const streetSource = real ? this.gen.fork('osm', SERVER_BASE, region.simulation) : this.gen
    const districtSource = this.gen.fork(real ? 'osm-district' : 'district', SERVER_BASE, region.simulation)
    this.chunks = new CityChunkManager(streetSource, { frame: this.frame, globalSeed: this.seed, datasetVersion: DATASET_VERSION, prefetchPad: real ? 2 : 1, unloadPad: 3, maxChunks: 96, concurrency: real ? 3 : 3, budget: 42 })
    this.districts = new CityChunkManager(districtSource, { frame: this.frame, globalSeed: this.seed, datasetVersion: DATASET_VERSION, prefetchPad: 1, unloadPad: 2, maxChunks: 160, concurrency: real ? 1 : 2, chunkZoom: DISTRICT_ZOOM, budget: 120 })
    this.realSources = { street: real ? streetSource : null, district: real ? districtSource : null }
    this.feeds = real && typeof window !== 'undefined' ? new LiveFeeds(this.world, { baseUrl: SERVER_BASE }) : null
    // Warm the streets around this origin on the server right away (a state just chosen): by the time the reader pans, tiles are there.
    if (real && typeof window !== 'undefined') { const o = region.origin; void fetch(`${SERVER_BASE}/api/warm?lng=${o.lng}&lat=${o.lat}`).catch(() => {}) }
    this.feeds?.subscribe(() => this.onFeeds())
    this.sim = new SimulationClient(80)
    this.intel = new IntelligencePipeline(this.world)
    this.zones = new ZoneEngine(this.world.unitPerMetre, this.frame.groundScale)
    this.memory = new UrbanMemory(60 * this.world.unitPerMetre)
    this.camera = new Camera({ x: 0, y: 0 }, 16.6)
    this.chunks.setHourBucket(Math.floor(startTime / 3600_000))
    this.sim.init(this.seed, this.world.unitPerMetre, startTime)

    this.chunks.on('loaded', (c) => this.onChunkLoaded(c))
    this.chunks.on('unloaded', (k) => this.onChunkUnloaded(k))
    this.chunks.on('error', (k, e) => console.error('chunk error', k, e))
    this.districts.on('loaded', (c) => { this.renderer?.addDistrict(c); this.districtNames.set(c.key, c.meta.districtName) })
    this.districts.on('unloaded', (k) => { this.renderer?.removeDistrict(k); this.districtNames.delete(k) })
    this.districts.on('error', (k, e) => console.error('district error', k, e))
    if (typeof window !== 'undefined') Object.defineProperty(window, '__cityatlas', { value: this, configurable: true, enumerable: false })
    this.sim.onSnapshot((s) => this.onSnapshot(s))
    this.temporal.subscribe((st, prev) => this.onTemporal(st, prev))
    this.camera.subscribe(() => this.notify())
    this.draw.subscribe(() => this.notify())
  }

  // ---------- store for React ----------
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getVersion(): number { return this.version }
  private notify(): void { this.version++; for (const l of this.listeners) l() }

  // ---------- lifecycle ----------
  mount(container: HTMLElement): void {
    this.renderer = new CompositeRenderer(container)
    this.renderer.setTheme(this.theme)
    this.renderer.svg.inkProvider = (c) => this.buildInk(c)
    for (const c of this.world.chunks.values()) this.renderer.addChunk(c)
    for (const c of this.districts.loaded.values()) this.renderer.addDistrict(c)
    const ro = new ResizeObserver(() => this.resize(container.clientWidth, container.clientHeight))
    ro.observe(container)
    this.resize(container.clientWidth, container.clientHeight)
    this.lastFrame = performance.now()
    this.feeds?.open()
    const loop = (now: number) => { if (this.disposed) return; this.frameStep(now); this.raf = requestAnimationFrame(loop) }
    this.raf = requestAnimationFrame(loop)
  }

  resize(w: number, h: number): void { this.camera.setSize(w, h); this.renderer?.resize(w, h) }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.renderer?.dispose()
    this.feeds?.close()
    this.chunks.dispose()
    this.districts.dispose()
    this.gen.dispose()
    this.sim.dispose()
  }

  // ---------- frame loop ----------
  private frameStep(now: number): void {
    const dt = Math.min(250, now - this.lastFrame)
    this.lastFrame = now
    const t0 = performance.now()
    this.temporal.tick(dt)
    const ts = this.temporal.current
    const view = this.camera.viewBounds()
    if (this.camera.version !== this.lastCameraVersion || now - this.lastReconcile > 400) {
      this.lastCameraVersion = this.camera.version; this.lastReconcile = now
      this.chunks.update(view, this.camera.centre)
      if (this.camera.zoom < 15.4) this.districts.update(view, this.camera.centre)
      this.feeds?.setView(view)
    }
    if (ts.mode === 'historical') {
      // Replay: show the recorded frame for this instant; the simulation is not consulted.
      const f = this.recorder.at(ts.timestamp)
      if (f && f.time !== this.world.snapshotTime) this.world.ingest(f)
    } else if (!ts.paused || this.world.snapshotTime === 0) this.sim.tick(ts.timestamp, now)
    if (now - this.lastIntel > 500 && this.world.snapshotTime > 0) { this.lastIntel = now; void this.runIntelligence() }
    const lod = this.lodController.lod(this.camera.zoom)
    this.renderer?.render(this.worldState(now, lod))
    const frameMs = performance.now() - t0
    this.lodController.report(frameMs)
    this.fpsAcc += dt; this.fpsN++
    if (this.fpsAcc >= 1000) {
      this.stats = { fps: Math.round((this.fpsN * 1000) / this.fpsAcc), frameMs: Math.round(frameMs * 10) / 10, agents: this.world.agents.size, chunks: this.world.chunks.size, inFlight: this.chunks.inFlight, simStepMs: Math.round(this.sim.stats.stepMs * 10) / 10, intelMs: this.stats.intelMs, simLagS: Math.round(this.sim.stats.lagS) }
      this.fpsAcc = 0; this.fpsN = 0
      this.notify()
    }
  }

  worldState(wallClock: number, lod = this.lodController.lod(this.camera.zoom)): WorldState {
    return { time: this.temporal.current.timestamp, wallClock, temporal: this.temporal.current, camera: this.camera, lod, mode: this.mode, layers: this.layers, world: this.world, intel: this.intel.state, zones: this.zones.list(), selection: this.selection, highlights: this.highlights, route: this.route, routePick: this.routePick, drawing: this.draw.state, hover: this.hover }
  }

  private lastSnapshot: SimSnapshot | null = null
  private async runIntelligence(): Promise<void> {
    if (!this.lastSnapshot) return
    const t0 = performance.now()
    const predictFor = this.selection?.kind === 'agent' ? [this.selection.id] : []
    if (this.layers.predictions) { let n = 0; for (const a of this.world.agents.values()) { if (a.kind === 'vehicle' && n < 12 && a.speed > 2 && this.inView(a)) { predictFor.push(a.id); n++ } } }
    const state = await this.intel.run(this.lastSnapshot, this.zones.list(), predictFor)
    const time = this.temporal.current.timestamp
    for (const a of state.anomalies) this.memory.record({ id: a.id, type: a.type, timestamp: a.timestamp, location: a.location, severity: a.severity, description: a.explanation, entityIds: a.entityIds, evidence: a.meta })
    for (const inc of this.world.activeIncidents(time)) this.memory.record({ id: inc.entity.id, type: `incident:${inc.props.kind}`, timestamp: inc.props.startTime, location: inc.point, severity: inc.props.severity, description: inc.props.description, entityIds: [inc.entity.id], evidence: inc.entity.evidence })
    const z = this.zones.evaluate(this.world.allAgents(), time)
    for (const e of z.events) { const zn = this.zones.zones.get(e.zoneId); if (zn && (e.type === 'count' || e.type === 'dwell' || e.type === 'density' || e.type === 'entry')) this.feeds?.postZoneEvent(zn.name, e.type, e.description, zn.ring[0] ? localToLngLat(this.frame, zn.ring[0]) : null) }
    for (const e of z.events) { this.zoneEvents.push(e); this.memory.record({ id: e.id, type: `zone:${e.type}`, timestamp: e.timestamp, location: this.zones.zones.get(e.zoneId)?.ring[0] ?? { x: 0, y: 0 }, severity: 0.3, description: e.description, entityIds: [`agent:${e.agentId}`], evidence: { classification: 'derived', model: 'zone-engine/1', timestamp: e.timestamp } }) }
    if (this.zoneEvents.length > 200) this.zoneEvents.splice(0, this.zoneEvents.length - 200)
    this.zoneStats = z.stats
    this.pulse = cityPulse(this.world, state, time)
    this.insights = this.computeInsights(state, time)
    this.stats.intelMs = Math.round((performance.now() - t0) * 10) / 10
    this.notify()
  }

  private inView(p: WorldPoint): boolean { const b = this.camera.viewBounds(); return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY }

  // ---------- events ----------
  private onChunkLoaded(c: ChunkData): void {
    this.world.addChunk(c)
    this.renderer?.addChunk(c)
    this.feeds?.rematch()
    // Real regions never get a made-up population or made-up incidents: the simulation only carries observed flow and live incidents.
    const sim = this.region.simulation
    this.sim.addChunk({ key: c.key, graph: c.graph, meta: sim ? c.meta : { ...c.meta, vehicleBudget: 0, pedestrianBudget: 0 }, incidents: sim ? c.entities.filter((e) => e.type === 'incident').map((e) => ({ id: e.id, props: e.properties as IncidentProperties })) : [] })
    this.notify()
  }
  private onChunkUnloaded(key: string): void { this.world.removeChunk(key); this.renderer?.removeChunk(key); this.sim.removeChunk(key); this.notify() }
  /** Feed results: condition the simulation and record live incidents. */
  private onFeeds(): void {
    this.sim.setObservedFlow([...this.world.observedFlow].map(([id, o]) => [id, o.level] as [string, number]))
    this.sim.setLiveIncidents(this.world.liveIncidents.map((e) => ({ id: e.id, props: e.properties as IncidentProperties })))
    for (const e of this.world.liveIncidents) {
      const p = e.properties as IncidentProperties
      const ie = this.world.entities.get(e.id)
      if (ie) this.memory.record({ id: e.id, type: `incident:${p.kind}`, timestamp: p.startTime, location: ie.local[0], severity: p.severity, description: p.description, entityIds: [e.id], evidence: e.evidence })
    }
    this.notify()
  }

  /** Live feed status for the UI. */
  get liveStatus(): { live: boolean; label: string; detail: string } {
    const f = this.feeds
    if (!f) return { live: false, label: 'demo · made-up city', detail: 'Engine demo: this city, its traffic and its incidents are made up. It is not data.' }
    const parts: string[] = []
    if (f.status.flow === 'open') parts.push('TomTom')
    if (f.status.weather === 'open') parts.push('Open-Meteo')
    const live = parts.length > 0
    const label = live ? `${parts.join(' + ')} + OpenStreetMap` : f.status.flow === 'error' ? 'no live traffic feed' : 'connecting feeds'
    const detail = `stream ${f.streamState} · flow ${f.status.flow} · incidents ${f.status.incidents} · weather ${f.status.weather}${f.dailyBudget ? ` · TomTom ${f.callsToday}/${f.dailyBudget} today` : ''}${f.lastError ? ` · ${f.lastError}` : ''}`
    return { live, label, detail }
  }

  private onSnapshot(s: SimSnapshot): void {
    if (this.temporal.current.mode === 'historical') return
    this.lastSnapshot = s
    this.world.ingest(s)
    if (this.temporal.current.mode === 'live') { this.recorder.record(s); this.temporal.setRecordedFrom(this.recorder.from) }
  }
  private onTemporal(st: TemporalState, prev: TemporalState): void {
    const bucket = Math.floor(st.timestamp / 3600_000)
    this.chunks.setHourBucket(bucket)
    // Leaving a replay, or jumping back beyond the recording, re-simulates deterministically from that instant.
    const leftReplay = prev.mode === 'historical' && st.mode !== 'historical'
    if (st.mode !== 'historical' && (st.timestamp < prev.timestamp - 1000 || leftReplay)) { this.sim.reset(st.timestamp); this.world.clearAgents(); this.intel.reset() }
    if (st.mode === 'historical' && prev.mode !== 'historical') { this.world.clearAgents(); this.intel.reset() }
    this.notify()
  }

  // ---------- Ink 3D (fogleman/ln hidden-line tier) ----------
  /** Chunks whose ink string is being built right now. */
  inkPending = 0
  private buildInk(c: ChunkData): void {
    this.inkPending++
    this.gen.ink(c, this.world.unitPerMetre).then((svg) => {
      c.svg.ink = svg
      const live = this.world.chunks.get(c.key)
      if (live) { live.svg.ink = svg; this.renderer?.refreshChunk(live) }
    }).catch((e) => console.warn((e as Error).message)).finally(() => { this.inkPending--; this.notify() })
  }

  /** A standalone SVG of the chunks in view, as drawn right now (ink lines in Ink 3D), for saving or plotting. */
  exportDrawing(): { svg: string; filename: string } {
    const b = this.camera.viewBounds()
    const keys: string[] = []
    for (const c of this.world.chunks.values()) if (c.bounds.maxX > b.minX && c.bounds.minX < b.maxX && c.bounds.maxY > b.minY && c.bounds.minY < b.maxY) keys.push(c.key)
    const groups = this.renderer?.svg.shown(keys) ?? []
    const title = `Atlas Infinity · ${this.region.name} · atlas://world/${this.seed}`
    return { svg: inkDocument(groups, b, title), filename: `atlas-infinity-${this.region.id}-${this.mode}.svg` }
  }

  // ---------- camera counts (Atlas Vision) ----------
  readonly vision = new VisionSession('cam-1')
  /** One-shot map click handler (calibration and camera placement). */
  pointPick: { label: string; cb: (p: WorldPoint, ll: LngLat) => void } | null = null
  pickMapPoint(label: string, cb: (p: WorldPoint, ll: LngLat) => void): void { this.pointPick = { label, cb }; this.notify() }
  cancelPick(): void { this.pointPick = null; this.notify() }

  /** Observations from the camera pipeline become observed agents (zones count them) and memory events. */
  onVisionObservations(obs: TrackObservation[]): void {
    const upm = this.world.unitPerMetre
    const views: AgentView[] = obs.map((o) => {
      const p = lngLatToLocal(this.frame, o.position)
      return { id: o.trackId, kind: o.kind, x: p.x, y: p.y, heading: o.heading, speed: o.speed * upm, edgeId: '', history: [], lastSeen: o.timestamp, evidence: { classification: 'observed', source: `camera:${this.vision.cameraId}`, timestamp: o.timestamp, confidence: o.confidence, model: 'tracker:sort-lite/1' } }
    })
    this.world.setObservedAgents(0, views)
    const people = views.filter((v) => v.kind === 'pedestrian').length
    if (views.length) this.feeds?.postCamera(this.vision.cameraId, people, views.length - people, this.vision.position)
    this.notify()
  }

  /** The nearest road edge that carries a live speed reading, for alert rules. */
  nearestObservedEdge(p: WorldPoint, maxM = 60): { edgeId: string; segment: string; roadName: string; tile: string } | null {
    const upm = this.world.unitPerMetre
    let best: { edgeId: string; d: number } | null = null
    for (const edgeId of this.world.observedFlow.keys()) {
      const e = this.world.graph.edge(edgeId); const ep = e && this.world.graph.endpoints(e); if (!e || !ep) continue
      const d = Math.hypot((ep.a.x + ep.b.x) / 2 - p.x, (ep.a.y + ep.b.y) / 2 - p.y)
      if (d <= maxM * upm && (!best || d < best.d)) best = { edgeId, d }
    }
    if (!best) return null
    const segment = this.feeds?.edgeSegment.get(best.edgeId)
    if (!segment) return null
    const e = this.world.graph.edge(best.edgeId)!
    const roadName = (this.world.entities.get(e.roadId)?.entity.properties as RoadProperties | undefined)?.name ?? 'this road'
    const tile = segment.split(':')[1] ?? ''
    return { edgeId: best.edgeId, segment, roadName, tile }
  }

  private visionCache: { key: string; frame: VisionFrame; t: number } | null = null
  /** The scene from the camera's eye (ln perspective hidden-line), re-rendered only when the pose or the chunks change. */
  visionFrame(width = 480, height = 270): VisionFrame | null {
    const c = this.vision.calibration
    if (!c || !c.position) return null
    const eye = lngLatToLocal(this.frame, c.position)
    const ground = this.vision.pairs.map((p) => lngLatToLocal(this.frame, p.ground))
    const key = `${eye.x.toFixed(1)},${eye.y.toFixed(1)}|${ground.map((g) => `${g.x.toFixed(0)},${g.y.toFixed(0)}`).join(';')}|${this.vision.heightM}|${this.world.chunks.size}|${width}x${height}`
    const now = performance.now()
    if (this.visionCache && this.visionCache.key === key && now - this.visionCache.t < 5000) return this.visionCache.frame
    const pose = poseFromPoints(eye, ground, this.vision.heightM * this.world.unitPerMetre)
    const frame = renderCameraScene(this.world.chunks.values(), pose, this.world.unitPerMetre, width, height)
    this.visionCache = { key, frame, t: now }
    return frame
  }
  /** Camera-observed agents projected into the vision frame. */
  visionDots(frame: VisionFrame): Array<{ x: number; y: number; kind: 'vehicle' | 'pedestrian' }> {
    const out: Array<{ x: number; y: number; kind: 'vehicle' | 'pedestrian' }> = []
    for (const a of this.world.observedAgents.values()) { const p = frame.project(a); if (p && p.x >= 0 && p.x <= frame.width && p.y >= 0 && p.y <= frame.height) out.push({ x: p.x, y: p.y, kind: a.kind }) }
    return out
  }
  lngLatOf(p: WorldPoint): LngLat { return localToLngLat(this.frame, p) }

  // ---------- interaction API (used by UI) ----------
  setMode(mode: ViewMode): void { this.mode = mode; this.layers = modeDefaults(mode); this.notify() }
  toggleLayer(key: keyof LayerFlags): void { this.layers = { ...this.layers, [key]: !this.layers[key] }; this.notify() }
  select(sel: Selection | null): void { this.selection = sel; this.notify() }
  setHover(sel: Selection | null): void { if (JSON.stringify(sel) !== JSON.stringify(this.hover)) { this.hover = sel; this.notify() } }
  clearHighlights(): void { this.highlights = { points: [], entityIds: [], agentIds: [] }; this.route = null; this.routePick = []; this.notify() }

  pointerClick(sx: number, sy: number): void {
    const p = this.camera.screenToWorld({ x: sx, y: sy })
    if (this.pointPick) { const pick = this.pointPick; this.pointPick = null; pick.cb(p, localToLngLat(this.frame, p)); this.notify(); return }
    if (this.draw.active) {
      const res = this.draw.click(p)
      if (res) this.finishShape(res)
      return
    }
    const hit = hitTest(this.world, this.camera, { x: sx, y: sy }, this.lodController.lod(this.camera.zoom))
    this.select(hit)
    // Click anywhere: the place intelligence card for that spot is read for every click (real regions);
    // when something was hit its details show first, with a button to the area card.
    if (this.region.source === 'osm') void this.openPlace(p)
  }
  pointerMove(sx: number, sy: number): void {
    const p = this.camera.screenToWorld({ x: sx, y: sy })
    if (this.draw.active) { this.draw.move(p); return }
    this.setHover(hitTest(this.world, this.camera, { x: sx, y: sy }, this.lodController.lod(this.camera.zoom)))
  }
  finishDrawing(): void { const r = this.draw.finish(); if (r) this.finishShape(r) }
  private finishShape(r: ZoneShape | { kind: 'route'; points: WorldPoint[] }): void {
    if (r.kind === 'route') {
      // Real regions: the loaded streets are only a window on the city, so two picked points route country-wide with live traffic.
      if (this.region.source === 'osm') { void this.routeFar(localToLngLat(this.frame, r.points[0]), localToLngLat(this.frame, r.points[1])); return }
      this.routePick = r.points; this.computeRoute(r.points[0], r.points[1]); return
    }
    const rules: ZoneRule[] = [{ type: 'entry' }, { type: 'exit' }, { type: 'dwell', threshold: 60 }, { type: 'count', threshold: 25 }, { type: 'speed', threshold: 16, kinds: ['vehicle'] }, { type: 'density', threshold: 80 }]
    this.zones.create(`Zone ${this.zones.zones.size + 1}`, r, rules, false, this.temporal.current.timestamp)
    this.notify()
  }
  setZoneRestricted(id: string, restricted: boolean): void { const z = this.zones.zones.get(id); if (z) { z.restricted = restricted; this.notify() } }
  removeZone(id: string): void { this.zones.remove(id); this.notify() }

  computeRoute(a: WorldPoint, b: WorldPoint): void {
    const from = nearestNode(this.world.graph, a), to = nearestNode(this.world.graph, b)
    if (!from || !to) return
    this.route = routeBetween({ graph: this.world.graph, risk: this.intel.state.risk, flow: this.intel.state.flow, unitPerMetre: this.world.unitPerMetre, time: this.temporal.current.timestamp }, from, to, this.routeWeights)
    this.notify()
  }
  /** A route between two chosen places (from the search box), drawn like a picked one. */
  setRouteEndpoints(a: WorldPoint, b: WorldPoint): void { this.routePick = [a, b]; this.computeRoute(a, b) }

  /** Routes across the whole country with live traffic (TomTom through the server), with the incidents the city has seen near each. */
  routeAnswer: RouteAnswer | null = null
  routeChoice = 0
  routeBusy = false
  routeError: string | null = null
  async routeFar(a: LngLat, b: LngLat): Promise<void> {
    this.routeBusy = true; this.routeError = null; this.routePick = [lngLatToLocal(this.frame, a), lngLatToLocal(this.frame, b)]; this.notify()
    try {
      this.routeAnswer = await serverRoute(SERVER_BASE, a, b)
      this.routeChoice = this.routeAnswer.recommended?.safer ?? 0
      this.applyRouteChoice()
      // fit the view to the route
      const pts = this.routeAnswer.routes[this.routeChoice]?.points ?? []
      if (pts.length) {
        const loc = pts.map((p) => lngLatToLocal(this.frame, { lng: p[0], lat: p[1] }))
        const minX = Math.min(...loc.map((p) => p.x)), maxX = Math.max(...loc.map((p) => p.x)), minY = Math.min(...loc.map((p) => p.y)), maxY = Math.max(...loc.map((p) => p.y))
        const spanM = Math.max(maxX - minX, maxY - minY) / this.world.unitPerMetre
        const zoom = Math.max(10.5, Math.min(16.5, 16.5 - Math.log2(Math.max(1, spanM / 900))))
        this.camera.setView({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, zoom)
      }
    } catch (e) { this.routeAnswer = null; this.route = null; this.routeError = (e as Error).message }
    finally { this.routeBusy = false; this.notify() }
  }
  chooseRoute(i: number): void { this.routeChoice = i; this.applyRouteChoice(); this.notify() }
  private applyRouteChoice(): void {
    const r = this.routeAnswer; const o: RouteOption | undefined = r?.routes[this.routeChoice]
    if (!r || !o) return
    const path = o.points.map((p) => lngLatToLocal(this.frame, { lng: p[0], lat: p[1] }))
    const time = o.travelTimeS || 1
    this.route = { edgeIds: [], nodeIds: [], path, totalCost: time, travelTimeS: time, distanceM: o.lengthM, factors: { travelTime: time, incidentRisk: o.incidentSeverity, congestion: (o.trafficDelayS || 0) / time, pedestrianRisk: 0, environmental: 0 }, explanation: r.explanation ?? [], evidence: r.evidence }
  }
  clearRoute(): void { this.routeAnswer = null; this.route = null; this.routePick = []; this.routeError = null; this.notify() }
  setRouteWeights(w: Partial<RouteWeights>): void { this.routeWeights = { ...this.routeWeights, ...w }; if (this.routePick.length === 2 && !this.routeAnswer) this.computeRoute(this.routePick[0], this.routePick[1]); else this.notify() }

  // ---------- place intelligence, what changed, tiers ----------
  place: PlaceState | null = null
  placePoint: WorldPoint | null = null
  placeLoading = false
  placeError: string | null = null
  async openPlace(p: WorldPoint): Promise<void> {
    const ll = localToLngLat(this.frame, p)
    this.placePoint = p; this.placeLoading = true; this.placeError = null; this.highlights = { ...this.highlights, points: [p] }; this.notify()
    try { this.place = await fetchPlace(SERVER_BASE, ll.lng, ll.lat) }
    catch (e) { this.place = null; this.placeError = (e as Error).message }
    finally { this.placeLoading = false; this.notify() }
  }
  async openPlaceAt(lng: number, lat: number): Promise<void> { return this.openPlace(lngLatToLocal(this.frame, { lng, lat })) }
  closePlace(): void { this.place = null; this.placePoint = null; this.placeError = null; this.highlights = { ...this.highlights, points: [] }; this.notify() }

  /** AROUND YOU: the cell at the centre of the view, refreshed every minute. */
  around: PlaceState | null = null
  private aroundAt = 0
  private aroundKey = ''
  async refreshAround(): Promise<void> {
    if (this.region.source !== 'osm') return
    const ll = localToLngLat(this.frame, this.camera.centre)
    const key = `${ll.lng.toFixed(3)},${ll.lat.toFixed(3)}`
    const now = Date.now()
    if (key === this.aroundKey && now - this.aroundAt < 60000) return
    this.aroundKey = key; this.aroundAt = now
    try { this.around = await fetchPlace(SERVER_BASE, ll.lng, ll.lat); this.notify() } catch { /* keep the last one */ }
  }

  changes: ChangeReport | null = null
  changesLoading = false
  async loadChanges(sinceS = 86400): Promise<ChangeReport | null> {
    if (this.region.source !== 'osm') return null
    const b = this.camera.viewBounds()
    const sw = localToLngLat(this.frame, { x: b.minX, y: b.maxY }), ne = localToLngLat(this.frame, { x: b.maxX, y: b.minY })
    this.changesLoading = true; this.notify()
    try { this.changes = await fetchChanges(SERVER_BASE, { west: Math.min(sw.lng, ne.lng), south: Math.min(sw.lat, ne.lat), east: Math.max(sw.lng, ne.lng), north: Math.max(sw.lat, ne.lat) }, sinceS) }
    catch { this.changes = null }
    finally { this.changesLoading = false; this.notify() }
    return this.changes
  }

  tier: Tier = loadTier()
  can(f: Feature): boolean { return hasFeature(this.tier, f) }
  /** Plus is a password for now; a wrong one returns false. */
  unlock(password: string): boolean { const t = unlockWithPassword(password); if (!t) return false; this.tier = t; saveTier(t); this.notify(); return true }
  lock(): void { this.tier = 'free'; saveTier('free'); this.notify() }

  // ---------- insights for the people who run the city ----------
  insights: Insight[] = []
  sound: boolean = (typeof localStorage !== 'undefined' && localStorage.getItem('atlas.sound') !== 'off')
  setSound(on: boolean): void { this.sound = on; try { localStorage.setItem('atlas.sound', on ? 'on' : 'off') } catch { /* private mode */ } this.notify() }
  /** A panel another part of the app (or the host page, through the embed) asks to open. */
  toolRequest: ToolName | null = null
  requestTool(t: ToolName | null): void { this.toolRequest = t; this.notify() }
  private edgeInfo(edgeId: string): { name: string; point: WorldPoint } | null {
    const g = this.world.graph
    const e = g.edge(edgeId); const ep = e && g.endpoints(e)
    if (!e || !ep) return null
    const name = String((this.world.entities.get(e.roadId)?.entity.properties as { name?: unknown } | undefined)?.name ?? '')
    return { name, point: { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 } }
  }
  private computeInsights(state: IntelligenceState, time: number): Insight[] {
    const w = this.world
    const flow: Array<{ edgeId: string; level: number; name: string; point: WorldPoint }> = []
    for (const [edgeId, f] of w.observedFlow) { const i = this.edgeInfo(edgeId); if (i && i.name && this.inViewPoint(i.point)) flow.push({ edgeId, level: f.level, name: i.name, point: i.point }) }
    const usual: Array<{ edgeId: string; now: number; usual: number | null; delta: number | null; samples: number; name: string; point: WorldPoint }> = []
    for (const [edgeId, u] of w.observedUsual) { const i = this.edgeInfo(edgeId); if (i && i.name) usual.push({ edgeId, now: u.now, usual: u.usual, delta: u.delta, samples: u.samples, name: i.name, point: i.point }) }
    const incidents = w.activeIncidents(time).map((i) => ({ id: i.entity.id, kind: i.props.kind, severity: i.props.severity, description: i.props.description, startTime: i.props.startTime, point: i.point, classification: i.entity.evidence.classification, source: i.entity.evidence.source ?? 'feed' }))
    const camPoint = this.vision.position ? lngLatToLocal(this.frame, this.vision.position) : null
    const camera = this.vision.status === 'running' ? { people: this.vision.stats.people, vehicles: this.vision.stats.vehicles, point: camPoint } : null
    const zoneEvents = this.zoneEvents.slice(-6).map((e) => { const z = this.zones.zones.get(e.zoneId); return { id: e.id, zone: z?.name ?? '', type: e.type as string, description: e.description, point: z?.ring[0] ?? null, timestamp: e.timestamp } })
    return deriveInsights({ time, flow, usual, incidents, hotspots: state.risk?.hotspots ?? [], anomalies: state.anomalies, weather: w.weather, camera, zoneEvents, unitPerMetre: w.unitPerMetre, congestion: state.flow && state.flow.observedEdges > 0 ? state.flow.congestedShare : null })
  }
  private inViewPoint(p: WorldPoint): boolean { const b = this.camera.viewBounds(); const pad = (b.maxX - b.minX) * 0.5; return p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad }

  // ---------- theme ----------
  /** Day (white paper and ink) is the default; night is the City Atlas deep-night look. Remembered per browser. */
  theme: Theme = (typeof localStorage !== 'undefined' && (localStorage.getItem('atlas.theme') as Theme | null)) || 'day'
  setTheme(t: Theme): void { this.theme = t; this.renderer?.setTheme(t); try { localStorage.setItem('atlas.theme', t) } catch { /* private mode */ } this.notify() }

  // ---------- language and the AI writer ----------
  language: Language = (typeof localStorage !== 'undefined' && (localStorage.getItem('atlas.language') as Language | null)) || 'en'
  setLanguage(l: Language): void { this.language = l; try { localStorage.setItem('atlas.language', l) } catch { /* private mode */ } this.notify() }
  readonly writer = new ClaudeExplainer(SERVER_BASE, () => this.language)
  /** Whether the server has an AI writer configured (null until checked). */
  writerConfigured: boolean | null = null
  private async checkWriter(): Promise<void> {
    try { const r = await fetch(`${SERVER_BASE}/api/writer/status`); const j = r.ok ? await r.json() as { configured: boolean } : { configured: false }; this.writerConfigured = !!j.configured } catch { this.writerConfigured = false }
    this.notify()
  }

  /**
   * What the app knows right now, as facts with their evidence class. This
   * is all a free question is answered from; nothing outside it exists for
   * the writer.
   */
  worldSnapshot(): EvidenceItem[] {
    const f: EvidenceItem[] = []
    const t = this.temporal.current
    const w = this.world
    const upm = w.unitPerMetre
    f.push({ id: 'region', classification: 'observed', statement: `Region: ${this.region.name}. Map time: ${new Date(t.timestamp).toUTCString()} (${t.mode}${t.paused ? ', paused' : ''}). Streets and buildings come from ${this.region.source === 'osm' ? 'OpenStreetMap (real)' : 'a seeded procedural city (not a real place)'}.`, source: this.region.source })
    f.push({ id: 'view', classification: 'observed', statement: `The view covers about ${Math.round((this.camera.viewBounds().maxX - this.camera.viewBounds().minX) / upm)} m across; ${w.chunks.size} map tiles are loaded${this.districtNames.size ? `; district names in view: ${[...new Set(this.districtNames.values())].slice(0, 6).join(', ')}` : ''}.` })
    const ls = this.liveStatus
    f.push({ id: 'feeds', classification: ls.live ? 'observed' : this.region.simulation ? 'simulated' : 'derived', statement: ls.live ? `Live feeds: ${ls.label}. ${ls.detail}` : this.region.simulation ? `Engine demo: this city and its traffic are made up. ${ls.detail}` : `No live traffic feed right now, so road speeds are unknown. ${ls.detail}`, source: ls.live ? 'tomtom' : this.region.simulation ? 'atlas.simulation' : 'atlas' })
    if (w.weather) f.push({ id: 'weather', classification: 'observed', statement: `Weather now: ${w.weather.description ?? 'unknown'}${w.weather.temperatureC != null ? `, ${Math.round(w.weather.temperatureC)} °C` : ''}${w.weather.precipitationMm ? `, ${w.weather.precipitationMm} mm rain` : ''}${w.weather.windKmh != null ? `, wind ${Math.round(w.weather.windKmh)} km/h` : ''}.`, source: w.weather.source })
    let vehicles = 0, peds = 0
    for (const a of w.agents.values()) { if (a.kind === 'vehicle') vehicles++; else peds++ }
    if (vehicles + peds > 0) f.push({ id: 'agents', classification: 'simulated', statement: `${vehicles} vehicles and ${peds} pedestrians are moving on the loaded streets (made up by the demo).`, source: 'atlas.simulation' })
    if (w.observedAgents.size) f.push({ id: 'camera', classification: 'observed', statement: `A camera is counting right now: ${[...w.observedAgents.values()].filter((a) => a.kind === 'pedestrian').length} people and ${[...w.observedAgents.values()].filter((a) => a.kind === 'vehicle').length} vehicles in its view.`, source: `camera:${this.vision.cameraId}` })
    const flow = this.intel.state.flow
    if (flow) {
      f.push({ id: 'flow', classification: flow.observedEdges > 0 ? 'observed' : 'derived', statement: `Traffic overall: average speed is ${Math.round(flow.meanSpeedRatio * 100)}% of free flow and ${Math.round(flow.congestedShare * 100)}% of road segments are congested${flow.observedEdges ? ` (${flow.observedEdges} segments from live TomTom speeds)` : ' (from the simulation)'}.`, confidence: 0.8 })
      const roads = new Map<string, { name: string; cong: number; observed: boolean }>()
      for (const e of flow.edges.values()) {
        if (e.congestion < 0.4) continue
        const edge = w.graph.edge(e.edgeId); if (!edge) continue
        const name = (w.entities.get(edge.roadId)?.entity.properties as RoadProperties | undefined)?.name ?? edge.roadId
        const r = roads.get(edge.roadId) ?? { name, cong: 0, observed: false }
        r.cong = Math.max(r.cong, e.congestion); r.observed = r.observed || e.source === 'tomtom'; roads.set(edge.roadId, r)
      }
      const top = [...roads.values()].sort((a, b) => b.cong - a.cong).slice(0, 5)
      if (top.length) f.push({ id: 'slow', classification: top.some((r) => r.observed) ? 'observed' : 'derived', statement: `Slowest roads: ${top.map((r) => `${r.name} (${Math.round(r.cong * 100)}% congested${r.observed ? ', live' : ''})`).join('; ')}.` })
    }
    // The memory: now versus usual for roads that have both a live reading and a baseline.
    const cmp: string[] = []
    for (const [edgeId, u] of w.observedUsual) { if (u.usual === null || cmp.length >= 4) continue; const e = w.graph.edge(edgeId); if (!e) continue; const name = (w.entities.get(e.roadId)?.entity.properties as RoadProperties | undefined)?.name ?? e.roadId; if (cmp.some((c) => c.startsWith(name))) continue; cmp.push(`${name}: ${Math.round(u.now * 100)}% of free speed now, usually ${Math.round(u.usual * 100)}% (${u.samples} past readings)`) }
    if (cmp.length) f.push({ id: 'usual', classification: 'derived', source: 'atlas.memory', statement: `Compared with what is usual at this hour: ${cmp.join('; ')}.` })
    else if (w.observedUsual.size) f.push({ id: 'usual', classification: 'derived', source: 'atlas.memory', statement: 'The memory does not yet have enough past readings at this hour to say what is usual.' })
    const incidents = w.activeIncidents(t.timestamp).slice(0, 6)
    if (incidents.length) f.push({ id: 'incidents', classification: incidents.some((i) => i.entity.evidence.classification === 'observed') ? 'observed' : 'simulated', statement: `Active incidents: ${incidents.map((i) => `${i.props.kind} (${i.props.description})`).join('; ')}.` })
    for (const a of this.intel.state.anomalies.slice(0, 4)) f.push({ id: a.id, classification: 'derived', statement: `Unusual: ${a.type.replace(/_/g, ' ')}: ${a.explanation}`, confidence: a.confidence })
    for (const h of (this.intel.state.activity?.hotspots ?? []).slice(0, 3)) f.push({ id: `hot:${h.x.toFixed(0)}`, classification: 'derived', statement: `Busy spot: ${h.reason}`, confidence: 0.7 })
    if (this.intel.state.forecast) { const fc = this.intel.state.forecast as unknown as { horizonMinutes?: number; summary?: string; edges?: Map<string, unknown> }; f.push({ id: 'forecast', classification: 'predicted', statement: `Forecast for the next ${fc.horizonMinutes ?? 30} minutes: ${fc.summary ?? `${fc.edges?.size ?? 0} road segments have a predicted congestion level`}.` }) }
    for (const z of this.zones.list()) { const st = this.zoneStats.get(z.id); f.push({ id: z.id, classification: 'derived', statement: `Zone "${z.name}"${z.restricted ? ' (restricted)' : ''}: ${st ? `${st.count.vehicle} vehicles and ${st.count.pedestrian} people inside now, average speed ${st.meanSpeed.toFixed(1)} m/s` : 'no count yet'}.` }) }
    const recent = this.zoneEvents.slice(-4)
    if (recent.length) f.push({ id: 'events', classification: 'derived', statement: `Latest zone events: ${recent.map((e) => e.description).join('; ')}.` })
    if (this.pulse) for (const c of this.pulse.categories) f.push({ id: `pulse:${c.id}`, classification: 'derived', statement: `City pulse, ${c.label}: ${c.index === null ? 'no data' : `index ${Math.round(c.index * 100)} out of 100`}${c.note ? ` (${c.note})` : ''}.` })
    if (this.route) f.push({ id: 'route', classification: 'derived', statement: `A route is drawn: ${Math.round(this.route.distanceM)} m, about ${Math.round(this.route.travelTimeS / 60)} minutes. ${this.route.explanation.slice(0, 2).join(' ')}` })
    if (this.selection) f.push({ id: 'selection', classification: 'observed', statement: `The user has selected ${this.selection.kind} ${String((this.selection as { id: string | number }).id)} on the map.` })
    return f.filter((x) => x.statement.trim().length > 0)
  }

  /** Questions about a place or about change are answered from the H3 city model (deterministic tools), then phrased. */
  private async askPlaceOrChange(question: string): Promise<Answer | null> {
    const q = question.toLowerCase()
    const hi = this.language === 'hi'
    const isPlace = /(what('| i)?s this (area|place|neighbourhood)|area like|place like|live here|should i live|move here|safe to live|buy here|rent here|यह इलाक़ा|यहाँ रहना|यह जगह कैसी)/.test(q)
    const isChange = /(what changed|what has changed|changed (around|here|near)|what's new|whats new|since yesterday|क्या बदला|नया क्या)/.test(q)
    if (!isPlace && !isChange || this.region.source !== 'osm') return null
    const facts: Answer['evidence'] = []
    let summary = ''
    if (isPlace) {
      if (!this.place || !this.placePoint) await this.openPlace(this.camera.centre)
      const st = this.place
      if (!st) return null
      const name = (k: string) => tr(this.language, `dim.${k}` as StringKey)
      const bandWord = (b: string | null) => (b ? tr(this.language, `band.${b}` as StringKey) : tr(this.language, 'place.nodata'))
      for (const d of st.dimensions) if (d.score !== null || d.key === 'flood') facts.push({ id: `dim:${d.key}`, classification: d.class === 'inferred' ? 'derived' : d.class === 'predicted' ? 'predicted' : d.class, statement: `${name(d.key)}: ${bandWord(d.band)}${d.score !== null ? ` (${d.score}/100)` : ''}. ${d.why[0] ?? ''}`, source: d.provenance[0]?.source, confidence: d.confidence ?? undefined })
      const strong = st.dimensions.filter((d) => d.score !== null && d.score >= 60).slice(0, 2).map((d) => name(d.key).toLowerCase())
      const weak = st.dimensions.filter((d) => d.score !== null && d.score < 45).slice(0, 2).map((d) => name(d.key).toLowerCase())
      summary = (hi ? `एटलस स्कोर ${st.score ?? '–'}/100 (${st.confidenceWord ? tr('hi', `conf.${st.confidenceWord}` as StringKey) : ''} भरोसा). ` : `Atlas score ${st.score ?? '–'}/100 (${st.confidenceWord ?? ''} confidence). `)
        + (strong.length && weak.length ? tr(this.language, 'place.summary.both', { strong: strong.join(', '), weak: weak.join(', ') }) : strong.length ? tr(this.language, 'place.summary.strong', { strong: strong.join(', ') }) : weak.length ? tr(this.language, 'place.summary.weak', { weak: weak.join(', ') }) : tr(this.language, 'place.summary.none'))
        + (hi ? ' हर पंक्ति नीचे बताती है कि वह कैसे जानती है।' : ' Each line below says how it knows; flood and population have no data yet.')
    } else {
      const r = await this.loadChanges()
      if (!r) return null
      for (const c of r.items.slice(0, 8)) facts.push({ id: c.id, classification: c.classification === 'inferred' ? 'derived' : c.classification, statement: c.text, source: c.source, confidence: c.confidence })
      summary = r.count ? tr(this.language, 'changed.count', { n: r.count }) + (hi ? ' सबसे अहम पहले; हर एक का स्रोत साथ है।' : '. The most significant first; each names its source.') : tr(this.language, 'changed.none')
      if (r.notDetectable.length) summary += (hi ? ` अभी नहीं पकड़ा जा सकता: ${r.notDetectable[0]}.` : ` Not yet detectable: ${r.notDetectable[0]}.`)
    }
    let text = summary
    if (this.writerConfigured) { const t = await this.writer.askFree(question, facts); if (t) text = t }
    return { question, intent: isPlace ? 'place' : 'changed', summary: text, classification: weakest(facts.length ? facts : [{ id: 'none', classification: 'observed', statement: '' }]), evidence: facts, highlights: { points: this.placePoint ? [this.placePoint] : [], entityIds: [], agentIds: [] }, caveats: [], writer: this.writer.lastWriter } as Answer
  }

  async ask(question: string): Promise<Answer> {
    const focus = this.camera.viewBounds()
    if (this.writerConfigured === null) await this.checkWriter()
    const special = await this.askPlaceOrChange(question)
    if (special) { this.lastAnswer = special; this.highlights = special.highlights; this.notify(); return special }
    const answer = await askTheCity(question, { world: this.world, intel: this.intel.state, memory: this.memory, time: this.temporal.current.timestamp, focus, focusPoint: this.camera.centre, unitPerMetre: this.world.unitPerMetre, explainer: this.writer, language: this.language })
    answer.writer = this.writer.lastWriter
    // A question the fixed intents do not cover goes to the writer as a free question, answered only from the snapshot.
    if (answer.intent === 'help' && this.writerConfigured) {
      const snapshot = this.worldSnapshot()
      const text = await this.writer.askFree(question, snapshot)
      if (text) { answer.summary = text; answer.intent = 'free'; answer.evidence = snapshot; answer.classification = weakest(snapshot); answer.writer = this.writer.lastWriter; answer.caveats = [this.language === 'hi' ? 'यह जवाब सिर्फ़ उन बातों से बना है जो नक्शा अभी जानता है।' : 'This answer is built only from what the map knows right now; the facts are listed below it.'] }
    }
    this.lastAnswer = answer
    this.highlights = answer.highlights
    this.notify()
    return answer
  }

  /** Upload a GeoJSON / JSON / CSV text as a new observed layer. */
  addUpload(name: string, text: string, sizeBytes: number): { entities: number; warnings: string[] } {
    const parsed = parseUploadedText(name, text, sizeBytes)
    const entities: UrbanEntity[] = featuresToEntities(parsed.collection, { source: `upload:${name}`, classification: 'observed' })
    const id = `upload:${name}:${Date.now()}`
    const colours = ['#1d6fa5', '#8a5a86', '#2f7f86', '#c98a2e']
    this.world.addLayer({ id, name, entities, visible: true, colour: colours[this.world.layers.size % colours.length] })
    this.notify()
    return { entities: entities.length, warnings: parsed.warnings }
  }
  removeLayer(id: string): void { this.world.removeLayer(id); this.notify() }
  toggleLayerVisible(id: string): void { const l = this.world.layers.get(id); if (l) { l.visible = !l.visible; this.notify() } }

  flyTo(p: WorldPoint, zoom?: number): void { this.camera.setView(p, zoom) }
  flyToLngLat(lng: number, lat: number, zoom?: number): void { this.flyTo(lngLatToLocal(this.frame, { lng, lat }), zoom) }
}
