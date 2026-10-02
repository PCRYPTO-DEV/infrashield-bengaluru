import type { UrbanEntity, RoadProperties, BuildingProperties, TrafficSignalProperties } from '../../entities/types'
import type { ChunkData, ChunkRequest, GraphEdge, GraphNode, RenderChunk } from '../../engine/world/chunkTypes'
import type { WorldFrame } from '../../geo/projection/frame'
import { lngLatToLocal, localToLngLat } from '../../geo/projection/frame'
import { parseTileKey, tileBounds } from '../../geo/tiles/tiles'
import type { Position } from '../../geo/geojson'
import { ROAD_WIDTH, ROAD_LANES } from '../../engine/procedural/grammar/roads'
import { hashMix } from '../../engine/seed/hash'
import { PRNG } from '../../engine/seed/prng'
import { buildChunkSvg } from '../../rendering/svg/chunkSvg'
import { polygonArea } from '../../geo/geometry'

/** The JSON the server returns for /api/tiles/osm/{z}/{x}/{y}.json. */
export interface OsmTile {
  key: string
  tier: 'street' | 'district'
  bounds: { west: number; south: number; east: number; north: number }
  entities: UrbanEntity[]
  fetchedAt: number
  source: string
}

/** Position-based node id shared by every tile that touches the same OSM node. */
export function osmNodeId(x: number, y: number): string {
  return `o${Math.round(x * 10)}_${Math.round(y * 10)}`
}

/**
 * Build a ChunkData from a real OpenStreetMap tile.
 *
 * Overpass returns whole ways for anything touching the tile, so neighbouring
 * tiles receive overlapping geometry. Ownership rule: a road segment belongs
 * to the tile that contains its midpoint, and a building or park to the tile
 * that contains its centroid. Boundary nodes are shared by position, so the
 * road graph connects across tiles with no communication between them.
 */
export function buildOsmChunk(req: ChunkRequest, tile: OsmTile): ChunkData {
  const t = parseTileKey(req.key)
  const frame: WorldFrame = req.frame
  const wb = tileBounds(t)
  const bounds = { minX: wb.minX - frame.originX, minY: wb.minY - frame.originY, maxX: wb.maxX - frame.originX, maxY: wb.maxY - frame.originY }
  const upm = 1 / frame.groundScale
  const inside = (p: { x: number; y: number }) => p.x >= bounds.minX && p.x < bounds.maxX && p.y >= bounds.minY && p.y < bounds.maxY
  const toLocal = (pos: Position) => lngLatToLocal(frame, { lng: pos[0], lat: pos[1] })
  const rng = new PRNG(hashMix(req.globalSeed, 'osm', req.key))

  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const render: RenderChunk = { roads: [], buildings: [], parks: [], signals: [], transit: [], construction: [], blocks: [] }
  const entities: UrbanEntity[] = []
  const edgesByRoad = new Map<string, string[]>()

  const node = (p: { x: number; y: number }) => {
    const id = osmNodeId(p.x, p.y)
    let n = nodes.get(id)
    if (!n) { n = { id, x: p.x, y: p.y, signal: false }; nodes.set(id, n) }
    return n
  }

  // ---- roads → render polylines (owned segments only) + directed edges ----
  for (const e of tile.entities) {
    if (e.type !== 'road' || e.geometry.type !== 'LineString') continue
    const props = e.properties as RoadProperties
    const pts = e.geometry.coordinates.map(toLocal)
    const speed = (props.speedLimit as number) * upm
    const lanes = (props.lanes as number) || ROAD_LANES[props.roadClass]
    let run: number[] = []
    const flushRun = () => { if (run.length >= 4) render.roads.push({ id: e.id, roadClass: props.roadClass, pts: run, width: ROAD_WIDTH[props.roadClass] * upm, name: props.name }); run = [] }
    const ids: string[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (!inside(mid)) { flushRun(); continue }
      if (run.length === 0) run.push(a.x, a.y)
      run.push(b.x, b.y)
      const na = node(a), nb = node(b)
      if (na.id === nb.id) continue
      const length = Math.hypot(nb.x - na.x, nb.y - na.y)
      const axis = Math.abs(nb.y - na.y) > Math.abs(nb.x - na.x) ? 'ns' : 'ew'
      const base = { roadId: e.id, roadClass: props.roadClass, lanes, oneway: !!props.oneway, speedLimit: speed, length, axis } as const
      edges.push({ id: `${na.id}>${nb.id}`, from: na.id, to: nb.id, ...base }); ids.push(`${na.id}>${nb.id}`)
      if (!props.oneway) { edges.push({ id: `${nb.id}>${na.id}`, from: nb.id, to: na.id, ...base }); ids.push(`${nb.id}>${na.id}`) }
    }
    flushRun()
    if (ids.length) { edgesByRoad.set(e.id, ids); entities.push({ ...e, properties: { ...props, edgeIds: ids } }) }
  }

  // ---- polygons owned by centroid ----
  let buildingArea = 0
  for (const e of tile.entities) {
    if (e.geometry.type !== 'Polygon') continue
    const ring = e.geometry.coordinates[0].slice(0, -1).map(toLocal)
    if (ring.length < 3) continue
    const c = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length }
    if (!inside(c)) continue
    const flat = ring.flatMap((p) => [p.x, p.y])
    const area = polygonArea(ring) * frame.groundScale * frame.groundScale
    if (e.type === 'building') {
      const bp = e.properties as BuildingProperties
      render.buildings.push({ id: e.id, ring: flat, floors: bp.floors, landUse: bp.landUse })
      buildingArea += area
      entities.push({ ...e, properties: { ...bp, footprintM2: Math.round(area) } })
    } else if (e.type === 'park') {
      render.parks.push({ id: e.id, ring: flat })
      entities.push({ ...e, properties: { ...e.properties, areaM2: Math.round(area) } })
    }
  }

  // ---- points ----
  const signals: TrafficSignalProperties[] = []
  for (const e of tile.entities) {
    if (e.geometry.type !== 'Point') continue
    const p = toLocal(e.geometry.coordinates)
    if (!inside(p)) continue
    if (e.type === 'traffic_signal') {
      // Attach to the nearest graph node within 20 m; OSM signal nodes usually sit on the way.
      let best: GraphNode | undefined, bd = 20 * upm
      for (const n of nodes.values()) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n } }
      if (!best) continue
      best.signal = true
      const cycle = rng.choice([60, 75, 90])
      const sp: TrafficSignalProperties = { nodeId: best.id, cycleSeconds: cycle, offsetSeconds: rng.int(0, cycle), greenNorthSouthSeconds: Math.round(cycle * rng.range(0.4, 0.6)), programmeSource: 'assumed' }
      signals.push(sp)
      render.signals.push({ id: `s:${best.id}`, x: best.x, y: best.y })
      entities.push({ ...e, id: `s:${best.id}`, properties: { ...e.properties, ...sp } })
    } else if (e.type === 'transit') {
      render.transit.push({ id: e.id, x: p.x, y: p.y, label: String(e.properties.name ?? 'Station') })
      entities.push(e)
    } else if (e.type === 'zone') {
      entities.push(e)
    }
  }

  // ---- intersections from graph degree ----
  const degree = new Map<string, number>()
  for (const ed of edges) degree.set(ed.from, (degree.get(ed.from) ?? 0) + 1)
  for (const n of nodes.values()) {
    const d = degree.get(n.id) ?? 0
    if (d >= 3 && inside(n)) entities.push({ id: `x:${n.id}`, type: 'intersection', geometry: { type: 'Point', coordinates: [0, 0] }, evidence: { classification: 'derived', source: 'openstreetmap', model: 'graph-degree/1', timestamp: tile.fetchedAt }, properties: { nodeId: n.id, degree: d, signalised: n.signal } })
  }
  // intersections need real lng/lat for the world index
  for (const e of entities) if (e.type === 'intersection') { const n = nodes.get((e.properties as { nodeId: string }).nodeId)!; const ll = localToLngLat(frame, n); e.geometry = { type: 'Point', coordinates: [ll.lng, ll.lat] } }

  const tileArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) * frame.groundScale * frame.groundScale
  const density = Math.min(1, buildingArea / Math.max(1, tileArea) * 2.2)
  const roadKm = render.roads.reduce((s, r) => { let l = 0; for (let i = 2; i < r.pts.length; i += 2) l += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]); return s + l }, 0) * frame.groundScale / 1000
  const place = tile.entities.find((e) => e.type === 'zone')
  const meta = { density, vehicleBudget: Math.round(Math.min(60, roadKm * 4 + density * 10)), pedestrianBudget: Math.round(Math.min(60, roadKm * 3 + density * 20)), districtName: String(place?.properties.name ?? 'Delhi NCR') }
  return {
    key: req.key, bounds, entities, graph: { nodes: [...nodes.values()], edges, signals }, render, meta,
    svg: { city: buildChunkSvg(req.key, render, 'city'), neighbourhood: buildChunkSvg(req.key, render, 'neighbourhood'), street: buildChunkSvg(req.key, render, 'street') },
    generatedAt: tile.fetchedAt, seed: hashMix(req.globalSeed, req.key, 'osm'),
  }
}

/** District tier from a zoom-13 OSM tile: major roads and place names only. */
export function buildOsmDistrict(req: ChunkRequest, tile: OsmTile): ChunkData {
  const t = parseTileKey(req.key)
  const frame: WorldFrame = req.frame
  const wb = tileBounds(t)
  const bounds = { minX: wb.minX - frame.originX, minY: wb.minY - frame.originY, maxX: wb.maxX - frame.originX, maxY: wb.maxY - frame.originY }
  const f = (n: number) => (Math.round(n * 10) / 10).toString()
  const parts: string[] = []
  const inside = (p: { x: number; y: number }) => p.x >= bounds.minX && p.x < bounds.maxX && p.y >= bounds.minY && p.y < bounds.maxY
  for (const e of tile.entities) {
    if (e.type !== 'road' || e.geometry.type !== 'LineString') continue
    const pts = e.geometry.coordinates.map((c) => lngLatToLocal(frame, { lng: c[0], lat: c[1] }))
    const cls = (e.properties as RoadProperties).roadClass
    let d = ''
    for (let i = 0; i < pts.length - 1; i++) { const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }; if (inside(m)) d += `M${f(pts[i].x)} ${f(pts[i].y)}L${f(pts[i + 1].x)} ${f(pts[i + 1].y)}` }
    if (d) parts.push(`<path d="${d}" stroke="${cls === 'arterial' ? 'rgba(43,42,38,0.42)' : 'rgba(43,42,38,0.16)'}" stroke-width="${cls === 'arterial' ? 44 : 16}" fill="none"/>`)
  }
  let name = ''
  for (const e of tile.entities) {
    if (e.type !== 'zone' || e.geometry.type !== 'Point') continue
    const p = lngLatToLocal(frame, { lng: e.geometry.coordinates[0], lat: e.geometry.coordinates[1] })
    if (!inside(p)) continue
    const label = String(e.properties.name ?? '')
    if (!name) name = label
    parts.push(`<g class="ca-d-label"><text x="${f(p.x)}" y="${f(p.y)}" font-size="260" text-anchor="middle" fill="rgba(43,42,38,0.38)" font-family="Georgia, serif" letter-spacing="30">${label.toUpperCase().replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></g>`)
  }
  const svg = `<g data-district="${req.key}">${parts.join('')}</g>`
  return {
    key: req.key, bounds, entities: [], graph: { nodes: [], edges: [], signals: [] },
    render: { roads: [], buildings: [], parks: [], signals: [], transit: [], construction: [], blocks: [] },
    meta: { density: 0, vehicleBudget: 0, pedestrianBudget: 0, districtName: name || 'Delhi NCR' },
    svg: { city: svg, neighbourhood: svg, street: svg }, generatedAt: tile.fetchedAt, seed: hashMix(req.globalSeed, req.key, 'osm-district'),
  }
}
