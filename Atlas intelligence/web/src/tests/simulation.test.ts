import { describe, it, expect } from 'vitest'
import { MovementEngine } from '../engine/simulation/movementEngine'
import { TemporalEngine } from '../engine/simulation/temporalEngine'
import { signalPhase } from '../engine/procedural/grammar/signals'
import { SnapshotRecorder } from '../engine/simulation/snapshotRecorder'
import { emptySnapshot } from '../engine/simulation/snapshot'
import { chunkAt, FRAME } from './helpers'
import type { SimChunkPayload } from '../engine/simulation/roadGraph'
import type { IncidentProperties } from '../entities/types'

function payload(dx = 0, dy = 0): SimChunkPayload {
  const c = chunkAt(dx, dy)
  return { key: c.key, graph: c.graph, meta: c.meta, incidents: c.entities.filter((e) => e.type === 'incident').map((e) => ({ id: e.id, props: e.properties as IncidentProperties })) }
}

function engine(): MovementEngine {
  const e = new MovementEngine({ globalSeed: 'sim', unitPerMetre: 1 / FRAME.groundScale })
  e.addChunk(payload(0, 0))
  e.addChunk(payload(1, 0))
  e.reset(0)
  return e
}

describe('movement engine', () => {
  it('is deterministic', () => {
    const a = engine(), b = engine()
    a.advanceTo(30_000); b.advanceTo(30_000)
    const sa = a.snapshot(), sb = b.snapshot()
    expect(sa.count).toBe(sb.count)
    expect(Array.from(sa.xs)).toEqual(Array.from(sb.xs))
    expect(Array.from(sa.speeds)).toEqual(Array.from(sb.speeds))
  })
  it('spawns a population and keeps agents on road edges', () => {
    const e = engine()
    expect(e.agentCount).toBeGreaterThan(20)
    e.advanceTo(20_000)
    const s = e.snapshot()
    for (let i = 0; i < s.count; i++) {
      const edge = e.graph.edge(s.edgeIds[i])!
      expect(edge).toBeDefined()
      const ep = e.graph.endpoints(edge)!
      const minX = Math.min(ep.a.x, ep.b.x) - 12, maxX = Math.max(ep.a.x, ep.b.x) + 12
      const minY = Math.min(ep.a.y, ep.b.y) - 12, maxY = Math.max(ep.a.y, ep.b.y) + 12
      expect(s.xs[i]).toBeGreaterThanOrEqual(minX); expect(s.xs[i]).toBeLessThanOrEqual(maxX)
      expect(s.ys[i]).toBeGreaterThanOrEqual(minY); expect(s.ys[i]).toBeLessThanOrEqual(maxY)
    }
  })
  it('vehicles respect spacing (no two on the same edge closer than a car length)', () => {
    const e = engine()
    e.advanceTo(60_000)
    const s = e.snapshot()
    const byEdge = new Map<string, number[]>()
    for (let i = 0; i < s.count; i++) if (s.kinds[i] === 0) { const l = byEdge.get(s.edgeIds[i]) ?? []; l.push(i); byEdge.set(s.edgeIds[i], l) }
    let violations = 0, pairs = 0
    for (const l of byEdge.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      pairs++
      const d = Math.hypot(s.xs[l[i]] - s.xs[l[j]], s.ys[l[i]] - s.ys[l[j]])
      if (d < 3.5) violations++
    }
    expect(violations / Math.max(1, pairs)).toBeLessThan(0.05)
  })
  it('removing a chunk removes its agents and edges', () => {
    const e = engine()
    const before = e.agentCount
    e.removeChunk(chunkAt(1, 0).key)
    expect(e.agentCount).toBeLessThan(before)
    expect(e.graph.chunkEdges.has(chunkAt(1, 0).key)).toBe(false)
    e.advanceTo(5_000)
    for (const id of e.snapshot().edgeIds) expect(e.graph.edge(id)).toBeDefined()
  })
  it('vehicles move', () => {
    const e = engine()
    const s0 = e.snapshot()
    e.advanceTo(10_000)
    const s1 = e.snapshot()
    let moved = 0
    for (let i = 0; i < s0.count; i++) if (Math.hypot(s0.xs[i] - s1.xs[i], s0.ys[i] - s1.ys[i]) > 1) moved++
    expect(moved).toBeGreaterThan(s0.count * 0.5)
  })
})

describe('signals', () => {
  it('phases are deterministic and cover the cycle', () => {
    const p = { nodeId: 'n', cycleSeconds: 60, offsetSeconds: 10, greenNorthSouthSeconds: 30 }
    const seen = new Set<string>()
    for (let t = 0; t < 60; t++) seen.add(signalPhase(p, t))
    expect(seen).toEqual(new Set(['ns', 'ew', 'all-red']))
    expect(signalPhase(p, 5)).toBe(signalPhase(p, 65))
  })
})

describe('temporal engine', () => {
  it('follows live time, scrubs into history and future, and rejoins live', () => {
    let real = 1000
    const t = new TemporalEngine(5_000_000, () => real)
    expect(t.current.mode).toBe('live')
    real += 1000; t.tick(1000)
    expect(t.current.timestamp).toBe(5_001_000)
    t.seek(4_000_000)
    // nothing recorded before the start: the past is a re-simulation, labelled as such
    expect(t.current.mode).toBe('simulation')
    expect(t.current.resimulated).toBe(true)
    t.setRecordedFrom(3_900_000)
    t.seek(4_000_000)
    expect(t.current.mode).toBe('historical')
    expect(t.current.resimulated).toBe(false)
    t.setSpeed(10)
    t.tick(1000)
    expect(t.current.timestamp).toBe(4_010_000)
    t.seek(9_000_000)
    expect(t.current.mode).toBe('simulation')
    t.pause(); t.tick(1000)
    expect(t.current.timestamp).toBe(9_000_000)
    t.goLive()
    expect(t.current.mode).toBe('live')
    expect(t.current.paused).toBe(false)
    expect(t.current.timestamp).toBe(5_001_000)
  })
  it('historical playback rejoins live when it catches up', () => {
    let real = 0
    const t = new TemporalEngine(100_000, () => real)
    t.setRecordedFrom(90_000)
    t.seek(99_000)
    t.setSpeed(100)
    t.tick(100)
    expect(t.current.mode).toBe('live')
  })
})

describe('snapshot recorder', () => {
  it('records at the interval, bounds memory, and replays by time', () => {
    const r = new SnapshotRecorder(1000, 3)
    for (const t of [0, 500, 1000, 2000, 3000, 4000]) r.record({ ...emptySnapshot(t), edgeIds: ['x'] })
    expect(r.size).toBe(3)
    expect(r.from).toBe(2000)
    expect(r.at(2500)!.time).toBe(2000)
    expect(r.at(4000)!.edgeIds).toEqual([])
    expect(r.at(100)).toBeUndefined()
  })
  it('engine fast-forward is incremental and converges', () => {
    const e = engine()
    e.advanceTo(600_000)
    expect(e.lag(600_000)).toBeGreaterThan(0)
    let guard = 0
    while (e.lag(600_000) > 0 && guard++ < 100) e.advanceTo(600_000)
    expect(e.lag(600_000)).toBe(0)
    expect(e.time).toBeCloseTo(600_000, -2)
  })
})
