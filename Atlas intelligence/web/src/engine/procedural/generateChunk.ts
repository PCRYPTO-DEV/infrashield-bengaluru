import { parseTileKey, tileBounds } from '../../geo/tiles/tiles'
import { localToLngLat, type WorldFrame } from '../../geo/projection/frame'
import type { Geometry, Position } from '../../geo/geojson'
import type { UrbanEntity, EvidenceMetadata, TrafficSignalProperties } from '../../entities/types'
import type { ChunkData, ChunkRequest, GraphEdge, GraphNode, RenderChunk, RenderRoad } from '../world/chunkTypes'
import { worldPRNG } from '../seed/worldSeed'
import { hashMix } from '../seed/hash'
import { Noise } from './noise'
import type { RoadBuildContext } from './grammar/roads'
import { generateOrganicNetwork } from './grammar/organic'
import { createCityFields, planBlocks, generateBuildings, generatePark, generateConstructionZone, generateTransitStop, toRenderBlocks } from './grammar/blocks'
import { generateTrafficSignals, toRenderSignals } from './grammar/signals'
import { generateIncidents } from './grammar/incidents'
import { districtName } from './grammar/names'
import { buildChunkSvg } from '../../rendering/svg/chunkSvg'

const noiseCache = new Map<string, Noise>()
function fieldsNoise(globalSeed: string): Noise {
  let n = noiseCache.get(globalSeed)
  if (!n) { n = new Noise(hashMix(globalSeed, 'fields')); noiseCache.set(globalSeed, n) }
  return n
}

function simulatedEvidence(datasetVersion: string, model: string): EvidenceMetadata {
  return { classification: 'simulated', source: 'atlas.procedural', model, datasetVersion, confidence: 1 }
}

/**
 * Generate one chunk. Pure: the same request always yields the same chunk,
 * regardless of which chunks were generated before it.
 */
export function generateChunk(req: ChunkRequest): ChunkData {
  const tile = parseTileKey(req.key)
  const frame: WorldFrame = req.frame
  const wb = tileBounds(tile)
  const bounds = { minX: wb.minX - frame.originX, minY: wb.minY - frame.originY, maxX: wb.maxX - frame.originX, maxY: wb.maxY - frame.originY }
  const size = bounds.maxX - bounds.minX
  const unitPerMetre = 1 / frame.groundScale
  const seedInput = { globalSeed: req.globalSeed, tileId: req.key, datasetVersion: req.datasetVersion }
  const seed = worldPRNG(seedInput)
  const rngBlocks = worldPRNG({ ...seedInput, stream: 'blocks' })
  const rngBuildings = worldPRNG({ ...seedInput, stream: 'buildings' })
  const rngSignals = worldPRNG({ ...seedInput, stream: 'signals' })

  const ctx: RoadBuildContext = {
    globalSeed: req.globalSeed, tile, minX: bounds.minX, minY: bounds.minY, size, unitPerMetre,
    nodes: new Map<string, GraphNode>(), edges: [], roads: [],
  }
  const layout = generateOrganicNetwork(ctx)
  const fields = createCityFields(fieldsNoise(req.globalSeed), unitPerMetre)
  const blocks = planBlocks(layout.blocks, fields, rngBlocks, unitPerMetre)

  const render: RenderChunk = { roads: ctx.roads, buildings: [], parks: [], signals: [], transit: [], construction: [], blocks: toRenderBlocks(blocks, unitPerMetre) }
  blocks.forEach((b, i) => {
    if (b.use === 'park') render.parks.push(generatePark(b, i, req.key, unitPerMetre))
    else if (b.use === 'construction') render.construction.push(generateConstructionZone(b, i, req.key, unitPerMetre))
    else if (b.use === 'transit') render.transit.push(generateTransitStop(b, i, req.key, rngBuildings.fork(i)))
    else render.buildings.push(...generateBuildings(b, i, req.key, rngBuildings.fork(i), unitPerMetre))
  })
  const signalPlans = generateTrafficSignals(ctx.nodes, ctx.edges, rngSignals)
  render.signals = toRenderSignals(signalPlans)

  const density = blocks.reduce((a, b) => a + b.density, 0) / Math.max(1, blocks.length)
  const incidents = generateIncidents(req.key, req.globalSeed, req.datasetVersion, req.hourBucket, ctx.edges, density)

  // ---- canonical entities (lng/lat) ----
  const ev = (model: string) => simulatedEvidence(req.datasetVersion, model)
  const toPos = (x: number, y: number): Position => { const ll = localToLngLat(frame, { x, y }); return [round6(ll.lng), round6(ll.lat)] }
  const ringGeom = (ring: number[]): Geometry => {
    const coords: Position[] = []
    for (let i = 0; i < ring.length; i += 2) coords.push(toPos(ring[i], ring[i + 1]))
    coords.push(coords[0])
    return { type: 'Polygon', coordinates: [coords] }
  }
  const lineGeom = (pts: number[]): Geometry => {
    const coords: Position[] = []
    for (let i = 0; i < pts.length; i += 2) coords.push(toPos(pts[i], pts[i + 1]))
    return { type: 'LineString', coordinates: coords }
  }
  const pointGeom = (x: number, y: number): Geometry => ({ type: 'Point', coordinates: toPos(x, y) })

  const entities: UrbanEntity[] = []
  const edgesByRoad = new Map<string, string[]>()
  for (const e of ctx.edges) { const l = edgesByRoad.get(e.roadId) ?? []; l.push(e.id); edgesByRoad.set(e.roadId, l) }
  for (const r of ctx.roads as RenderRoad[]) {
    entities.push({ id: r.id, type: 'road', geometry: lineGeom(r.pts), evidence: ev('road-grammar/1'), properties: {
      name: r.name, roadClass: r.roadClass, lanes: ctx.edges.find((e) => e.roadId === r.id)?.lanes ?? 1, oneway: false,
      speedLimit: (ctx.edges.find((e) => e.roadId === r.id)?.speedLimit ?? 8) * frame.groundScale, edgeIds: edgesByRoad.get(r.id) ?? [],
    } })
  }
  for (const b of render.buildings) {
    const w = Math.abs(b.ring[2] - b.ring[0]) * frame.groundScale, h = Math.abs(b.ring[5] - b.ring[1]) * frame.groundScale
    entities.push({ id: b.id, type: 'building', geometry: ringGeom(b.ring), evidence: ev('building-grammar/1'), properties: { landUse: b.landUse, floors: b.floors, heightM: Math.round(b.floors * 3.2), footprintM2: Math.round(w * h) } })
  }
  for (const p of render.parks) {
    const w = Math.abs(p.ring[2] - p.ring[0]) * frame.groundScale, h = Math.abs(p.ring[5] - p.ring[1]) * frame.groundScale
    entities.push({ id: p.id, type: 'park', geometry: ringGeom(p.ring), evidence: ev('block-grammar/1'), properties: { name: 'Neighbourhood park', areaM2: Math.round(w * h) } })
  }
  for (const c of render.construction) {
    entities.push({ id: c.id, type: 'construction', geometry: ringGeom(c.ring), evidence: ev('block-grammar/1'), properties: { name: 'Construction site', startTime: 0, endTime: Number.MAX_SAFE_INTEGER, laneReduction: 1 } })
  }
  for (const t of render.transit) {
    entities.push({ id: t.id, type: 'transit', geometry: pointGeom(t.x, t.y), evidence: ev('block-grammar/1'), properties: { name: t.label, mode: t.label.startsWith('Metro') ? 'metro' : 'bus' } })
  }
  const degree = new Map<string, number>()
  for (const e of ctx.edges) degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
  for (const n of ctx.nodes.values()) {
    const d = degree.get(n.id) ?? 0
    if (d >= 3) entities.push({ id: `x:${n.id}`, type: 'intersection', geometry: pointGeom(n.x, n.y), evidence: ev('road-grammar/1'), properties: { nodeId: n.id, degree: d, signalised: n.signal } })
  }
  const signals: TrafficSignalProperties[] = []
  for (const s of signalPlans) {
    signals.push(s.props)
    entities.push({ id: `s:${s.node.id}`, type: 'traffic_signal', geometry: pointGeom(s.node.x, s.node.y), evidence: ev('signal-grammar/1'), properties: s.props })
  }
  for (const inc of incidents) {
    const a = ctx.nodes.get(inc.edge.from)!, b = ctx.nodes.get(inc.edge.to)!
    entities.push({ id: inc.id, type: 'incident', geometry: pointGeom((a.x + b.x) / 2, (a.y + b.y) / 2), timestamp: inc.props.startTime, evidence: ev('incident-grammar/1'), properties: inc.props })
  }

  const edges: GraphEdge[] = ctx.edges
  const nodes: GraphNode[] = [...ctx.nodes.values()]
  const meta = {
    density,
    vehicleBudget: Math.round(8 + density * 34),
    pedestrianBudget: Math.round(10 + density * 40),
    districtName: districtName(seed.fork('district')),
  }
  return {
    key: req.key,
    bounds,
    entities,
    graph: { nodes, edges, signals },
    render,
    meta,
    svg: {
      city: buildChunkSvg(req.key, render, 'city'),
      neighbourhood: buildChunkSvg(req.key, render, 'neighbourhood'),
      street: buildChunkSvg(req.key, render, 'street'),
    },
    generatedAt: 0,
    seed: hashMix(req.globalSeed, req.key, req.datasetVersion),
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
