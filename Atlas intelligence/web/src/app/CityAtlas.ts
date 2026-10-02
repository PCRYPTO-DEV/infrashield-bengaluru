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

export type Theme = 'day' | 'night'

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
    this.chunks = new CityChunkManager(streetSource, { frame: this.frame, globalSeed: this.seed, datasetVersion: DATASET_VERSION, prefetchPad: 1, unloadPad: 3, maxChunks: 64, concurrency: real ? 2 : 3, budget: 42 })
    this.districts = new CityChunkManager(districtSource, { frame: this.frame, globalSeed: this.seed, datasetVersion: DATASET_VERSION, prefetchPad: 1, unloadPad: 2, maxChunks: 160, concurrency: real ? 1 : 2, chunkZoom: DISTRICT_ZOOM, budget: 120 })
    this.realSources = { street: real ? streetSource : null, district: real ? districtSource : null }
    this.feeds = real && typeof window !== 'undefined' ? new LiveFeeds(this.world, { baseUrl: SERVER_BASE }) : null
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
    const detail = `flow ${f.status.flow} · incidents ${f.status.incidents} · weather ${f.status.weather}${f.dailyBudget ? ` · TomTom ${f.callsToday}/${f.dailyBudget} today` : ''}${f.lastError ? ` · ${f.lastError}` : ''}`
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
    this.select(hitTest(this.world, this.camera, { x: sx, y: sy }, this.lodController.lod(this.camera.zoom)))
  }
  pointerMove(sx: number, sy: number): void {
    const p = this.camera.screenToWorld({ x: sx, y: sy })
    if (this.draw.active) { this.draw.move(p); return }
    this.setHover(hitTest(this.world, this.camera, { x: sx, y: sy }, this.lodController.lod(this.camera.zoom)))
  }
  finishDrawing(): void { const r = this.draw.finish(); if (r) this.finishShape(r) }
  private finishShape(r: ZoneShape | { kind: 'route'; points: WorldPoint[] }): void {
    if (r.kind === 'route') { this.routePick = r.points; this.computeRoute(r.points[0], r.points[1]); return }
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
  setRouteWeights(w: Partial<RouteWeights>): void { this.routeWeights = { ...this.routeWeights, ...w }; if (this.routePick.length === 2) this.computeRoute(this.routePick[0], this.routePick[1]); else this.notify() }

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

  async ask(question: string): Promise<Answer> {
    const focus = this.camera.viewBounds()
    if (this.writerConfigured === null) await this.checkWriter()
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
