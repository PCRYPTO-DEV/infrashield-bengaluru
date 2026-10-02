import { describe, it, expect } from 'vitest'
import { buildOsmChunk, buildOsmDistrict, osmNodeId, type OsmTile } from '../data/sources/osmChunk'
import { createFrame, localToLngLat } from '../geo/projection/frame'
import { tileBounds, tileKey, worldToTile, parseTileKey } from '../geo/tiles/tiles'
import { lngLatToWorld } from '../geo/projection/mercator'
import { DATASET_VERSION } from '../engine/seed/worldSeed'
import { REGIONS, regionFromSearch } from '../app/regions'
import { RoadGraph } from '../engine/simulation/roadGraph'
import type { UrbanEntity } from '../entities/types'

const ORIGIN = REGIONS.ncr.origin
const FRAME = createFrame(ORIGIN)

/** A fixture: one east-west arterial crossing from tile A into its east neighbour B, plus a building in each. */
function fixture() {
  const base = worldToTile(lngLatToWorld(ORIGIN))
  const keyA = tileKey(base), keyB = tileKey({ ...base, x: base.x + 1 })
  const bA = tileBounds(base), bB = tileBounds({ ...base, x: base.x + 1 })
  const ll = (x: number, y: number) => localToLngLat(FRAME, { x: x - FRAME.originX, y: y - FRAME.originY })
  const midY = (bA.minY + bA.maxY) / 2
  const road = { type: 'LineString' as const, coordinates: [ll(bA.minX + 50, midY), ll(bA.minX + 200, midY), ll(bA.maxX - 50, midY), ll(bA.maxX + 50, midY), ll(bB.maxX - 50, midY)].map((p) => [p.lng, p.lat] as [number, number]) }
  const cross = { type: 'LineString' as const, coordinates: [ll(bA.minX + 200, bA.minY + 50), ll(bA.minX + 200, midY), ll(bA.minX + 200, bA.maxY - 50)].map((p) => [p.lng, p.lat] as [number, number]) }
  const bld = (cx: number, cy: number) => { const r = 20; const ring = [ll(cx - r, cy - r), ll(cx + r, cy - r), ll(cx + r, cy + r), ll(cx - r, cy + r), ll(cx - r, cy - r)].map((p) => [p.lng, p.lat] as [number, number]); return { type: 'Polygon' as const, coordinates: [ring] } }
  const ev = { classification: 'observed' as const, source: 'openstreetmap', timestamp: 1000, confidence: 0.9 }
  const roadEnt: UrbanEntity = { id: 'osm:w1', type: 'road', geometry: road, evidence: ev, properties: { name: 'Ring Road', roadClass: 'arterial', lanes: 3, oneway: false, speedLimit: 13.9, edgeIds: [] } }
  const crossEnt: UrbanEntity = { id: 'osm:w2', type: 'road', geometry: cross, evidence: ev, properties: { name: 'Cross', roadClass: 'local', lanes: 1, oneway: false, speedLimit: 8.3, edgeIds: [] } }
  const sigLL = ll(bA.minX + 200, midY)
  const signal: UrbanEntity = { id: 'osm:n9', type: 'traffic_signal', geometry: { type: 'Point', coordinates: [sigLL.lng, sigLL.lat] }, evidence: ev, properties: { nodeId: 'osm:n9', cycleSeconds: 0, offsetSeconds: 0, greenNorthSouthSeconds: 0 } }
  const entsA: UrbanEntity[] = [roadEnt, crossEnt, signal, { id: 'osm:w3', type: 'building', geometry: bld(bA.minX + 300, bA.minY + 300), evidence: ev, properties: { landUse: 'office', floors: 12, heightM: 38, footprintM2: 0 } }, { id: 'osm:w4', type: 'building', geometry: bld(bB.minX + 300, bB.minY + 300), evidence: ev, properties: { landUse: 'residential', floors: 3, heightM: 9, footprintM2: 0 } }]
  const tileA: OsmTile = { key: keyA, tier: 'street', bounds: { west: 0, south: 0, east: 0, north: 0 }, entities: entsA, fetchedAt: 1000, source: 'openstreetmap' }
  const tileB: OsmTile = { ...tileA, key: keyB }
  return { keyA, keyB, tileA, tileB }
}

const req = (key: string) => ({ key, globalSeed: 'ncr-2026', datasetVersion: DATASET_VERSION, hourBucket: 0, frame: FRAME })

describe('OSM chunk builder', () => {
  it('splits ownership by midpoint and shares boundary nodes across tiles', () => {
    const { keyA, keyB, tileA, tileB } = fixture()
    const a = buildOsmChunk(req(keyA), tileA), b = buildOsmChunk(req(keyB), tileB)
    expect(a.graph.edges.length).toBeGreaterThan(0)
    expect(b.graph.edges.length).toBeGreaterThan(0)
    const aNodes = new Set(a.graph.nodes.map((n) => n.id))
    const shared = b.graph.nodes.filter((n) => aNodes.has(n.id))
    expect(shared.length).toBeGreaterThanOrEqual(1)
    // neither tile duplicates the other's segments
    const aEdges = new Set(a.graph.edges.map((e) => e.id))
    expect(b.graph.edges.some((e) => aEdges.has(e.id))).toBe(false)
    // the graph connects when both are loaded
    const g = new RoadGraph()
    g.addChunk({ key: a.key, graph: a.graph, meta: a.meta, incidents: [] })
    g.addChunk({ key: b.key, graph: b.graph, meta: b.meta, incidents: [] })
    const crossing = shared[0]
    expect(g.outEdges(crossing.id).length).toBeGreaterThanOrEqual(2)
    expect(g.edgeCount).toBe(a.graph.edges.length + b.graph.edges.length)
  })
  it('keeps observed evidence, assigns buildings by centroid, and attaches signals to nodes', () => {
    const { keyA, keyB, tileA, tileB } = fixture()
    const a = buildOsmChunk(req(keyA), tileA), b = buildOsmChunk(req(keyB), tileB)
    expect(a.render.buildings.map((x) => x.id)).toEqual(['osm:w3'])
    expect(b.render.buildings.map((x) => x.id)).toEqual(['osm:w4'])
    for (const e of a.entities.filter((x) => x.type !== 'intersection')) expect(e.evidence.classification).toBe('observed')
    expect(a.graph.signals.length).toBe(1)
    expect(a.graph.nodes.some((n) => n.signal)).toBe(true)
    expect(a.entities.find((e) => e.type === 'intersection')).toBeDefined()
    expect(a.svg.street).toContain('RING ROAD')
    expect(a.meta.vehicleBudget).toBeGreaterThan(0)
    const road = a.entities.find((e) => e.id === 'osm:w1')!
    expect((road.properties.edgeIds as string[]).length).toBeGreaterThan(0)
  })
  it('district tier draws only major roads and place names', () => {
    const { keyA, tileA } = fixture()
    const t = parseTileKey(keyA)
    const dKey = tileKey({ z: 13, x: t.x >> 3, y: t.y >> 3 })
    const d = buildOsmDistrict(req(dKey), { ...tileA, key: dKey, tier: 'district' })
    expect(d.svg.city).toContain('<path')
    expect(d.graph.edges.length).toBe(0)
  })
  it('node ids are positional', () => {
    expect(osmNodeId(1.23, 4.56)).toBe(osmNodeId(1.23, 4.56))
  })
})

describe('regions', () => {
  it('parses the region from the URL and defaults to NCR', () => {
    expect(regionFromSearch('?region=bengaluru').id).toBe('bengaluru')
    expect(regionFromSearch('').id).toBe('ncr')
    expect(regionFromSearch('?region=nowhere').id).toBe('ncr')
    expect(REGIONS.ncr.source).toBe('osm')
  })
})
