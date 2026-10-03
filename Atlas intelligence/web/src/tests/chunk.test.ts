import { describe, it, expect } from 'vitest'
import { chunkAt } from './helpers'
import { nodeId } from '../engine/procedural/grammar/roads'

describe('chunk generation', () => {
  it('is deterministic for the same request', () => {
    const a = chunkAt(0, 0), b = chunkAt(0, 0)
    expect(a.svg.street).toBe(b.svg.street)
    expect(a.graph.edges.map((e) => e.id)).toEqual(b.graph.edges.map((e) => e.id))
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id))
    expect(JSON.stringify(a.entities)).toBe(JSON.stringify(b.entities))
  })
  it('differs for a different seed', () => {
    expect(chunkAt(0, 0, 'A').svg.street).not.toBe(chunkAt(0, 0, 'B').svg.street)
  })
  it('contains the full urban grammar', () => {
    const c = chunkAt(0, 0)
    const types = new Set(c.entities.map((e) => e.type))
    expect(types.has('road')).toBe(true)
    expect(types.has('building')).toBe(true)
    expect(types.has('intersection')).toBe(true)
    expect(c.graph.edges.length).toBeGreaterThan(10)
    expect(c.render.buildings.length).toBeGreaterThan(10)
    for (const e of c.entities) expect(e.evidence.classification).toBe('simulated')
  })
  it('neighbouring chunks share boundary nodes so roads connect', () => {
    const a = chunkAt(0, 0), east = chunkAt(1, 0), south = chunkAt(0, 1)
    const aNodes = new Set(a.graph.nodes.map((n) => n.id))
    const sharedEast = east.graph.nodes.filter((n) => aNodes.has(n.id))
    const sharedSouth = south.graph.nodes.filter((n) => aNodes.has(n.id))
    expect(sharedEast.length).toBeGreaterThanOrEqual(2)
    expect(sharedSouth.length).toBeGreaterThanOrEqual(2)
    // every horizontal road A owns ends on the east boundary street, at a node EAST (which owns that street) also has
    const eastNodes = new Set(east.graph.nodes.map((n) => n.id))
    const horizontals = a.render.roads.filter((r) => /:(n|h\d+)$/.test(r.id))
    expect(horizontals.length).toBeGreaterThan(0)
    for (const r of horizontals) {
      const lastId = nodeId(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1])
      expect(eastNodes.has(lastId)).toBe(true)
    }
    // no edge is owned by both tiles
    const aEdges = new Set(a.graph.edges.map((e) => e.id))
    expect(east.graph.edges.some((e) => aEdges.has(e.id))).toBe(false)
  })
  it('streets are organic: a road has more than two vertices and bends', () => {
    const c = chunkAt(0, 0)
    const long = c.render.roads.filter((r) => r.pts.length >= 8)
    expect(long.length).toBeGreaterThan(0)
    const r = long[0]
    const xs = [], ys = []
    for (let i = 0; i < r.pts.length; i += 2) { xs.push(r.pts[i]); ys.push(r.pts[i + 1]) }
    const spreadMinor = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    expect(spreadMinor).toBeGreaterThan(3)
  })
  it('node ids are a pure function of position', () => {
    expect(nodeId(12.34, -5.67)).toBe(nodeId(12.34, -5.67))
  })
  it('entities are in lng/lat near Bengaluru', () => {
    const c = chunkAt(0, 0)
    const b = c.entities.find((e) => e.type === 'building')!
    const ring = (b.geometry as { coordinates: number[][][] }).coordinates[0]
    for (const [lng, lat] of ring) { expect(lng).toBeGreaterThan(77); expect(lng).toBeLessThan(78); expect(lat).toBeGreaterThan(12); expect(lat).toBeLessThan(14) }
  })
  it('incidents depend on the hour bucket', () => {
    const ids0 = chunkAt(0, 0, 'test-seed', 100).entities.filter((e) => e.type === 'incident').map((e) => e.id)
    const ids1 = chunkAt(0, 0, 'test-seed', 500).entities.filter((e) => e.type === 'incident').map((e) => e.id)
    expect(ids0).not.toEqual(ids1)
  })
})
