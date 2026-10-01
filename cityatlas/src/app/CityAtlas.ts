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
import { SnapshotRecorder } from '../engine/simulation/snapshotRecorder'

export const DEMO_ORIGIN = { lng: 77.6101, lat: 12.9719 } // Bengaluru, Indiranagar–Koramangala corridor
export const DEFAULT_SEED = 'bengaluru-2026'

export interface AppStats { fps: number; frameMs: number; agents: number; chunks: number; inFlight: number; simStepMs: number; intelMs: number; simLagS: number }

/**
 * CityAtlas: the composition root. Owns every engine, runs the frame loop,
 * and exposes a tiny external store for React (which only renders UI).
 */
export class CityAtlas {
  readonly frame: WorldFrame
  readonly seed: string
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

  constructor(seed = DEFAULT_SEED, origin = DEMO_ORIGIN, startTime = Date.now()) {
    this.seed = seed
    this.frame = createFrame(origin)
    this.temporal = new TemporalEngine(startTime)
    this.world = new WorldModel(this.frame)
    this.gen = new WorldGenerationClient()
    this.chunks = new CityChunkManager(this.gen, { frame: this.frame, globalSeed: seed, datasetVersion: DATASET_VERSION, prefetchPad: 1, unloadPad: 3, maxChunks: 64, concurrency: 3, budget: 42 })
    this.districts = new CityChunkManager(this.gen.fork('district'), { frame: this.frame, globalSeed: seed, datasetVersion: DATASET_VERSION, prefetchPad: 1, unloadPad: 2, maxChunks: 160, concurrency: 2, chunkZoom: DISTRICT_ZOOM, budget: 120 })
    this.sim = new SimulationClient(80)
    this.intel = new IntelligencePipeline(this.world)
    this.zones = new ZoneEngine(this.world.unitPerMetre, this.frame.groundScale)
    this.memory = new UrbanMemory(60 * this.world.unitPerMetre)
    this.camera = new Camera({ x: 0, y: 0 }, 16.6)
    this.chunks.setHourBucket(Math.floor(startTime / 3600_000))
    this.sim.init(seed, this.world.unitPerMetre, startTime)

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
    for (const c of this.world.chunks.values()) this.renderer.addChunk(c)
    for (const c of this.districts.loaded.values()) this.renderer.addDistrict(c)
    const ro = new ResizeObserver(() => this.resize(container.clientWidth, container.clientHeight))
    ro.observe(container)
    this.resize(container.clientWidth, container.clientHeight)
    this.lastFrame = performance.now()
    const loop = (now: number) => { if (this.disposed) return; this.frameStep(now); this.raf = requestAnimationFrame(loop) }
    this.raf = requestAnimationFrame(loop)
  }

  resize(w: number, h: number): void { this.camera.setSize(w, h); this.renderer?.resize(w, h) }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.renderer?.dispose()
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
    const z = this.zones.evaluate(this.world.agents.values(), time)
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
    this.sim.addChunk({ key: c.key, graph: c.graph, meta: c.meta, incidents: c.entities.filter((e) => e.type === 'incident').map((e) => ({ id: e.id, props: e.properties as IncidentProperties })) })
    this.notify()
  }
  private onChunkUnloaded(key: string): void { this.world.removeChunk(key); this.renderer?.removeChunk(key); this.sim.removeChunk(key); this.notify() }
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

  // ---------- interaction API (used by UI) ----------
  setMode(mode: ViewMode): void { this.mode = mode; this.layers = modeDefaults(mode); this.notify() }
  toggleLayer(key: keyof LayerFlags): void { this.layers = { ...this.layers, [key]: !this.layers[key] }; this.notify() }
  select(sel: Selection | null): void { this.selection = sel; this.notify() }
  setHover(sel: Selection | null): void { if (JSON.stringify(sel) !== JSON.stringify(this.hover)) { this.hover = sel; this.notify() } }
  clearHighlights(): void { this.highlights = { points: [], entityIds: [], agentIds: [] }; this.route = null; this.routePick = []; this.notify() }

  pointerClick(sx: number, sy: number): void {
    const p = this.camera.screenToWorld({ x: sx, y: sy })
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

  async ask(question: string): Promise<Answer> {
    const focus = this.camera.viewBounds()
    const answer = await askTheCity(question, { world: this.world, intel: this.intel.state, memory: this.memory, time: this.temporal.current.timestamp, focus, focusPoint: this.camera.centre, unitPerMetre: this.world.unitPerMetre })
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
