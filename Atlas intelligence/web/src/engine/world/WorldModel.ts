import type { ChunkData } from './chunkTypes'
import type { UrbanEntity, MovingKind, IncidentProperties, EvidenceMetadata } from '../../entities/types'
import type { WorldBounds, WorldPoint } from '../../geo/projection/mercator'
import type { WorldFrame } from '../../geo/projection/frame'
import { lngLatToLocal } from '../../geo/projection/frame'
import { GridIndex } from '../../geo/spatial-index/gridIndex'
import { RoadGraph } from '../simulation/roadGraph'
import type { SimSnapshot } from '../simulation/snapshot'
import { boundsOf, pointInPolygon, pointToPolyline } from '../../geo/geometry'
import type { Geometry, Position } from '../../geo/geojson'

export interface AgentSample { t: number; x: number; y: number; speed: number }

/** Main-thread mirror of a moving entity, with a short observed history. */
export interface AgentView {
  id: number
  kind: MovingKind
  x: number
  y: number
  heading: number
  speed: number
  edgeId: string
  history: AgentSample[]
  evidence: EvidenceMetadata
  lastSeen: number
}

/** A static entity with its local-coordinate geometry cached for hit tests. */
export interface IndexedEntity {
  entity: UrbanEntity
  chunkKey: string
  /** flattened local rings / lines */
  local: WorldPoint[]
  bounds: WorldBounds
}

export interface ExternalLayer {
  id: string
  name: string
  entities: UrbanEntity[]
  visible: boolean
  colour: string
}

/**
 * The Urban World Model: the canonical, source-agnostic view of the city
 * that every renderer, analyser and query runs against. Renderers never
 * learn whether an entity came from a chunk generator, an upload or a
 * camera — only its type, geometry and evidence.
 */
export class WorldModel {
  readonly graph = new RoadGraph()
  readonly entities = new Map<string, IndexedEntity>()
  readonly index = new GridIndex<IndexedEntity>(120)
  readonly agents = new Map<number, AgentView>()
  /** Agents seen by cameras (observed), kept apart from the simulation's so snapshots never purge them. */
  readonly observedAgents = new Map<number, AgentView>()
  readonly chunks = new Map<string, ChunkData>()
  readonly layers = new Map<string, ExternalLayer>()
  private chunkEntityIds = new Map<string, string[]>()
  private incidentIds = new Set<string>()
  private lastSampleTime = -Infinity
  snapshotTime = 0
  /** Observed per-edge speed level (current / free-flow, 0..1) from a live feed. */
  observedFlow = new Map<string, { level: number; t: number; source: string }>()
  observedFlowMeta: { t: number; source: string; segments: number } | null = null
  /** What each observed edge usually reads at this weekday and hour (from the server's memory). */
  observedUsual = new Map<string, { now: number; usual: number | null; samples: number; basis: string; delta: number | null; segment: string }>()
  setObservedUsual(m: Map<string, { now: number; usual: number | null; samples: number; basis: string; delta: number | null; segment: string }>): void { this.observedUsual = m }
  /** Latest observed weather for the region, or null when no feed is connected. */
  weather: import('../../data/realtime/liveFeeds').WeatherNow | null = null
  liveIncidents: UrbanEntity[] = []

  constructor(public readonly frame: WorldFrame) {}

  get unitPerMetre(): number { return 1 / this.frame.groundScale }

  addChunk(chunk: ChunkData): void {
    if (this.chunks.has(chunk.key)) this.removeChunk(chunk.key)
    this.chunks.set(chunk.key, chunk)
    this.graph.addChunk({ key: chunk.key, graph: chunk.graph, meta: chunk.meta, incidents: chunk.entities.filter((e) => e.type === 'incident').map((e) => ({ id: e.id, props: e.properties as IncidentProperties })) })
    const ids: string[] = []
    for (const e of chunk.entities) {
      const ie = this.indexEntity(e, chunk.key)
      if (!ie) continue
      this.entities.set(e.id, ie)
      this.index.insert(ie, ie.bounds)
      if (e.type === 'incident') this.incidentIds.add(e.id)
      ids.push(e.id)
    }
    this.chunkEntityIds.set(chunk.key, ids)
  }

  removeChunk(key: string): void {
    const ids = this.chunkEntityIds.get(key) ?? []
    for (const id of ids) { const ie = this.entities.get(id); if (ie) { this.index.remove(ie); this.entities.delete(id); this.incidentIds.delete(id) } }
    this.chunkEntityIds.delete(key)
    this.chunks.delete(key)
    this.graph.removeChunk(key)
    for (const a of [...this.agents.values()]) if (!this.graph.edge(a.edgeId)) this.agents.delete(a.id)
  }

  addLayer(layer: ExternalLayer): void {
    this.removeLayer(layer.id)
    this.layers.set(layer.id, layer)
    const ids: string[] = []
    for (const e of layer.entities) {
      const ie = this.indexEntity(e, `layer:${layer.id}`)
      if (!ie) continue
      this.entities.set(e.id, ie); this.index.insert(ie, ie.bounds); ids.push(e.id)
      if (e.type === 'incident') this.incidentIds.add(e.id)
    }
    this.chunkEntityIds.set(`layer:${layer.id}`, ids)
  }

  removeLayer(id: string): void {
    if (!this.layers.has(id)) return
    for (const eid of this.chunkEntityIds.get(`layer:${id}`) ?? []) { const ie = this.entities.get(eid); if (ie) { this.index.remove(ie); this.entities.delete(eid); this.incidentIds.delete(eid) } }
    this.chunkEntityIds.delete(`layer:${id}`)
    this.layers.delete(id)
  }

  private indexEntity(e: UrbanEntity, chunkKey: string): IndexedEntity | null {
    const local = flattenLocal(this.frame, e.geometry)
    if (local.length === 0) return null
    return { entity: e, chunkKey, local, bounds: boundsOf(local) }
  }

  /** Ingest a simulation (or observation) snapshot into the agent mirror. */
  ingest(s: SimSnapshot): void {
    this.snapshotTime = s.time
    const sample = s.time - this.lastSampleTime >= 400
    if (sample) this.lastSampleTime = s.time
    const seen = new Set<number>()
    for (let i = 0; i < s.count; i++) {
      const id = s.ids[i]
      seen.add(id)
      let a = this.agents.get(id)
      if (!a) {
        a = { id, kind: s.kinds[i] === 0 ? 'vehicle' : 'pedestrian', x: 0, y: 0, heading: 0, speed: 0, edgeId: '', history: [], lastSeen: s.time, evidence: { classification: s.classification, source: s.classification === 'simulated' ? 'atlas.simulation' : 'feed', timestamp: s.time } }
        this.agents.set(id, a)
      }
      a.x = s.xs[i]; a.y = s.ys[i]; a.heading = s.headings[i]; a.speed = s.speeds[i]; a.edgeId = s.edgeIds[i] ?? a.edgeId; a.lastSeen = s.time
      a.evidence.timestamp = s.time
      if (sample) {
        a.history.push({ t: s.time, x: a.x, y: a.y, speed: a.speed })
        if (a.history.length > 40) a.history.shift()
      }
    }
    for (const id of [...this.agents.keys()]) if (!seen.has(id)) this.agents.delete(id)
  }

  setObservedFlow(levels: Map<string, number>, t: number, source: string, segments: number): void {
    this.observedFlow.clear()
    for (const [id, level] of levels) this.observedFlow.set(id, { level, t, source })
    this.observedFlowMeta = { t, source, segments }
  }

  /** Replace the live incident layer (observed, from a feed). */
  setLiveIncidents(entities: UrbanEntity[]): void {
    this.liveIncidents = entities
    this.addLayer({ id: 'live:incidents', name: 'Live incidents', entities, visible: true, colour: '#b5493a' })
  }

  /** Reset agent histories (e.g. after a time jump). */
  clearAgents(): void { this.agents.clear(); this.lastSampleTime = -Infinity }

  /** Replace the camera-observed agents of one camera; ids are negative so they never collide with simulated ones. */
  setObservedAgents(cameraIndex: number, views: AgentView[]): void {
    const base = -(cameraIndex + 1) * 100_000
    for (const id of [...this.observedAgents.keys()]) if (id <= base && id > base - 100_000) this.observedAgents.delete(id)
    for (const v of views) this.observedAgents.set(base - (Math.abs(v.id) % 100_000), { ...v, id: base - (Math.abs(v.id) % 100_000) })
  }
  /** Simulated and camera-observed agents together (zones, counts). */
  *allAgents(): IterableIterator<AgentView> { yield* this.agents.values(); yield* this.observedAgents.values() }

  activeIncidents(time: number): Array<{ entity: UrbanEntity; props: IncidentProperties; point: WorldPoint }> {
    const out: Array<{ entity: UrbanEntity; props: IncidentProperties; point: WorldPoint }> = []
    for (const id of this.incidentIds) {
      const ie = this.entities.get(id)
      if (!ie) continue
      const p = ie.entity.properties as IncidentProperties
      if (time >= p.startTime && time <= p.endTime) out.push({ entity: ie.entity, props: p, point: ie.local[0] })
    }
    return out
  }

  entitiesIn(b: WorldBounds): IndexedEntity[] { return this.index.query(b) }

  /** Nearest agent to a local point within radius. */
  nearestAgent(p: WorldPoint, radius: number): AgentView | undefined {
    let best: AgentView | undefined, bd = radius
    for (const a of this.agents.values()) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a } }
    return best
  }

  /** Topmost static entity under a point: points, then polygons, then lines. */
  entityAt(p: WorldPoint, tolerance: number): IndexedEntity | undefined {
    const cands = this.index.queryPoint(p, tolerance)
    let bestPoint: IndexedEntity | undefined, bestPolygon: IndexedEntity | undefined, bestLine: IndexedEntity | undefined
    let dp = tolerance, dl = tolerance, polyArea = Infinity
    for (const c of cands) {
      const g = c.entity.geometry.type
      if (g === 'Point') { const d = Math.hypot(c.local[0].x - p.x, c.local[0].y - p.y); if (d < dp) { dp = d; bestPoint = c } }
      else if (g === 'Polygon' || g === 'MultiPolygon') {
        if (pointInPolygon(p, c.local)) { const area = (c.bounds.maxX - c.bounds.minX) * (c.bounds.maxY - c.bounds.minY); if (area < polyArea) { polyArea = area; bestPolygon = c } }
      } else { const d = pointToPolyline(p, c.local); if (d < dl) { dl = d; bestLine = c } }
    }
    return bestPoint ?? bestPolygon ?? bestLine
  }

  nearestRoad(p: WorldPoint, radius: number): IndexedEntity | undefined {
    let best: IndexedEntity | undefined, bd = radius
    for (const c of this.index.queryPoint(p, radius)) {
      if (c.entity.type !== 'road') continue
      const d = pointToPolyline(p, c.local); if (d < bd) { bd = d; best = c }
    }
    return best
  }
}

export function flattenLocal(frame: WorldFrame, g: Geometry): WorldPoint[] {
  const conv = (pos: Position) => lngLatToLocal(frame, { lng: pos[0], lat: pos[1] })
  switch (g.type) {
    case 'Point': return [conv(g.coordinates)]
    case 'MultiPoint': return g.coordinates.map(conv)
    case 'LineString': return g.coordinates.map(conv)
    case 'MultiLineString': return g.coordinates.flat().map(conv)
    case 'Polygon': return g.coordinates[0].slice(0, -1).map(conv)
    case 'MultiPolygon': return g.coordinates[0]?.[0]?.slice(0, -1).map(conv) ?? []
    case 'GeometryCollection': return g.geometries.flatMap((x) => flattenLocal(frame, x))
  }
}
