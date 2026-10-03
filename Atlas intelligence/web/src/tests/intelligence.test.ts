import { describe, it, expect } from 'vitest'
import { WorldModel } from '../engine/world/WorldModel'
import { MovementEngine } from '../engine/simulation/movementEngine'
import { IntelligencePipeline } from '../intelligence/pipeline'
import { MovementPredictor } from '../intelligence/prediction/movementPredictor'
import { routeBetween, nearestNode, DEFAULT_WEIGHTS } from '../intelligence/routing/saferRouter'
import { scoreSites } from '../intelligence/business/siteScorer'
import { UrbanMemory } from '../intelligence/memory/urbanMemory'
import { cityPulse } from '../intelligence/pulse/cityPulse'
import { parseIntent } from '../intelligence/reasoning/intentParser'
import { askTheCity } from '../intelligence/reasoning/askTheCity'
import { ZoneEngine } from '../zones/zoneEngine'
import { lodForZoom, LodController } from '../rendering/lod'
import { chunkAt, FRAME } from './helpers'
import type { IncidentProperties } from '../entities/types'
import type { AgentView } from '../engine/world/WorldModel'

function setup() {
  const world = new WorldModel(FRAME)
  const engine = new MovementEngine({ globalSeed: 'intel', unitPerMetre: world.unitPerMetre })
  for (const c of [chunkAt(0, 0, 'intel'), chunkAt(1, 0, 'intel')]) {
    world.addChunk(c)
    engine.addChunk({ key: c.key, graph: c.graph, meta: c.meta, incidents: c.entities.filter((e) => e.type === 'incident').map((e) => ({ id: e.id, props: e.properties as IncidentProperties })) })
  }
  const t0 = 1_800_000_000_000
  engine.reset(t0)
  return { world, engine, t0 }
}

describe('intelligence pipeline', () => {
  it('produces flow, density, activity, risk, forecast and anomalies with correct classifications', async () => {
    const { world, engine, t0 } = setup()
    const pipe = new IntelligencePipeline(world)
    let state = pipe.state
    for (let i = 1; i <= 8; i++) { engine.advanceTo(t0 + i * 2000); const s = engine.snapshot(); world.ingest(s); state = await pipe.run(s, [], []) }
    expect(state.flow!.evidence.classification).toBe('derived')
    expect(state.density!.evidence.classification).toBe('derived')
    expect(state.activity!.evidence.classification).toBe('derived')
    expect(state.risk!.evidence.classification).toBe('derived')
    expect(state.forecast!.evidence.classification).toBe('predicted')
    expect(state.flow!.edges.size).toBeGreaterThan(5)
    expect(state.density!.cells.size).toBeGreaterThan(3)
    for (const a of state.anomalies) { expect(a.evidence.length).toBeGreaterThan(0); expect(a.explanation.length).toBeGreaterThan(10); expect(a.meta.classification).toBe('derived') }
    expect(pipe.history.flows.length).toBe(8)
  })
})

describe('prediction baseline', () => {
  it('constant-velocity fallback and road-constrained paths are labelled predicted with growing envelope', async () => {
    const { world, engine, t0 } = setup()
    engine.advanceTo(t0 + 5000); world.ingest(engine.snapshot())
    const pipe = new IntelligencePipeline(world)
    const agent = [...world.agents.values()].find((a) => a.kind === 'vehicle' && a.speed > 1)!
    const p = await MovementPredictor.process({ agent, horizonS: 30 }, pipe.context(t0 + 5000))
    expect(p.evidence.classification).toBe('predicted')
    expect(p.method).toBe('road-constrained')
    expect(p.path.length).toBe(31)
    expect(p.envelope[30]).toBeGreaterThan(p.envelope[0])
    expect(p.confidence).toBeLessThan(1)
    const ghost: AgentView = { ...agent, edgeId: 'missing', x: 0, y: 0, heading: 0, speed: 5, history: [] }
    const cv = await MovementPredictor.process({ agent: ghost, horizonS: 10 }, pipe.context(t0))
    expect(cv.method).toBe('constant-velocity')
    expect(cv.path[10].x).toBeCloseTo(50, 5)
  })
})

describe('routing', () => {
  it('finds a route and explains cost without claiming safety', () => {
    const { world, t0 } = setup()
    const nodes = [...world.graph.nodes.values()]
    const a = nodes[0], b = nodes[nodes.length - 1]
    const r = routeBetween({ graph: world.graph, unitPerMetre: world.unitPerMetre, time: t0 }, a.id, b.id)
    expect(r).not.toBeNull()
    expect(r!.edgeIds.length).toBeGreaterThan(0)
    expect(r!.nodeIds[0]).toBe(a.id)
    expect(r!.nodeIds[r!.nodeIds.length - 1]).toBe(b.id)
    expect(r!.explanation.join(' ')).toMatch(/not a guarantee of safety/)
    expect(r!.evidence.classification).toBe('derived')
    const fast = routeBetween({ graph: world.graph, unitPerMetre: world.unitPerMetre, time: t0 }, a.id, b.id, { ...DEFAULT_WEIGHTS, environmental: 0 })!
    expect(fast.travelTimeS).toBeLessThanOrEqual(r!.travelTimeS + 1e-6)
    expect(nearestNode(world.graph, { x: a.x + 1, y: a.y + 1 })).toBe(a.id)
  })
})

describe('zones', () => {
  it('raises entry, exit and dwell events', () => {
    const z = new ZoneEngine(1, 1)
    const zone = z.create('box', { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, [{ type: 'entry' }, { type: 'exit' }, { type: 'dwell', threshold: 5 }], false, 0)
    const mk = (x: number, speed = 1): AgentView => ({ id: 1, kind: 'pedestrian', x, y: 5, heading: 0, speed, edgeId: 'e', history: [], lastSeen: 0, evidence: { classification: 'simulated' } })
    expect(z.evaluate([mk(-5)], 0).events).toEqual([])
    const e1 = z.evaluate([mk(5)], 1000).events
    expect(e1.map((e) => e.type)).toEqual(['entry'])
    expect(z.evaluate([mk(5, 0)], 3000).events).toEqual([])
    const e2 = z.evaluate([mk(5, 0)], 7000).events
    expect(e2.map((e) => e.type)).toEqual(['dwell'])
    const e3 = z.evaluate([mk(50)], 8000).events
    expect(e3.map((e) => e.type)).toEqual(['exit'])
    expect(e3[0].value).toBeCloseTo(7, 5)
    expect(zone.ring.length).toBe(4)
    const stats = z.evaluate([mk(2), { ...mk(3), id: 2, kind: 'vehicle' }], 9000).stats.get(zone.id)!
    expect(stats.count).toEqual({ vehicle: 1, pedestrian: 1 })
    expect(stats.density).toBeGreaterThan(0)
  })
  it('radius and corridor shapes resolve to rings', () => {
    const z = new ZoneEngine(1, 1)
    expect(z.create('r', { kind: 'radius', centre: { x: 0, y: 0 }, radius: 5 }, []).ring.length).toBe(32)
    expect(z.create('c', { kind: 'corridor', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], width: 4 }, []).ring.length).toBe(4)
  })
})

describe('memory, pulse, site scoring, ask', () => {
  it('memory records, dedupes and queries by location and time', () => {
    const m = new UrbanMemory(10)
    const ev = { type: 'incident', timestamp: 1000, location: { x: 5, y: 5 }, severity: 0.5, description: 'x', entityIds: [], evidence: { classification: 'simulated' as const } }
    expect(m.record({ id: 'a', ...ev })).toBe(true)
    expect(m.record({ id: 'a', ...ev })).toBe(false)
    m.record({ id: 'b', ...ev, timestamp: 5000, location: { x: 100, y: 100 } })
    expect(m.near({ x: 0, y: 0 }, 20).map((e) => e.id)).toEqual(['a'])
    expect(m.between(2000, 6000).map((e) => e.id)).toEqual(['b'])
    expect(m.patterns(0, 10000).get('incident')).toBe(2)
    expect(m.timeline({ x: 5, y: 5 }, 10, 0, 10000)[0].events[0].id).toBe('a')
  })
  it('city pulse exposes measurements and refuses to invent environment data', async () => {
    const { world, engine, t0 } = setup()
    engine.advanceTo(t0 + 3000); world.ingest(engine.snapshot())
    const pipe = new IntelligencePipeline(world)
    const st = await pipe.run(engine.snapshot(), [], [])
    const p = cityPulse(world, st, t0 + 3000)
    const env = p.categories.find((c) => c.id === 'environment')!
    expect(env.index).toBeNull()
    for (const c of p.categories) expect(c.measurements.length).toBeGreaterThan(0)
  })
  it('site scorer ranks candidates with factor breakdowns', async () => {
    const { world, engine, t0 } = setup()
    engine.advanceTo(t0 + 3000); world.ingest(engine.snapshot())
    const pipe = new IntelligencePipeline(world)
    const st = await pipe.run(engine.snapshot(), [], [])
    const c = chunkAt(0, 0, 'intel')
    const cands = scoreSites({ world, intel: st, time: t0, unitPerMetre: world.unitPerMetre }, c.bounds)
    expect(cands.length).toBe(5)
    expect(cands[0].score).toBeGreaterThanOrEqual(cands[4].score)
    expect(cands[0].factors.length).toBe(7)
    expect(cands[0].evidence.classification).toBe('derived')
  })
  it('intent parser maps the canonical questions', () => {
    expect(parseIntent("What's happening here?").kind).toBe('whats_happening')
    expect(parseIntent('Why is traffic slow?').kind).toBe('why_slow')
    expect(parseIntent('Show unusual activity').kind).toBe('unusual')
    expect(parseIntent('Where are the dangerous intersections?').kind).toBe('dangerous_intersections')
    expect(parseIntent('Show activity during the last hour')).toEqual({ kind: 'history', minutes: 60 })
    expect(parseIntent('What may happen in the next 30 minutes?')).toEqual({ kind: 'forecast', minutes: 30 })
    expect(parseIntent('Where should I open a café?')).toMatchObject({ kind: 'site_selection' })
    expect(parseIntent('gibberish').kind).toBe('help')
  })
  it('ask the city returns evidence-backed answers with caveats', async () => {
    const { world, engine, t0 } = setup()
    const pipe = new IntelligencePipeline(world)
    let st = pipe.state
    for (let i = 1; i <= 4; i++) { engine.advanceTo(t0 + i * 2000); world.ingest(engine.snapshot()); st = await pipe.run(engine.snapshot(), [], []) }
    const c = chunkAt(0, 0, 'intel')
    const ctx = { world, intel: st, memory: new UrbanMemory(60), time: t0 + 8000, focus: c.bounds, focusPoint: { x: (c.bounds.minX + c.bounds.maxX) / 2, y: (c.bounds.minY + c.bounds.maxY) / 2 }, unitPerMetre: world.unitPerMetre }
    const a = await askTheCity("What's happening here?", ctx)
    expect(a.evidence.length).toBeGreaterThan(0)
    expect(a.summary.length).toBeGreaterThan(20)
    expect(a.caveats.join(' ')).toMatch(/simulation/)
    const h = await askTheCity('Show activity during the last hour', ctx)
    expect(h.evidence[0].statement).toMatch(/does not fabricate history/)
    const f = await askTheCity('What may happen in the next 30 minutes?', ctx)
    expect(f.classification).toBe('predicted')
  })
})

describe('LOD', () => {
  it('selects by zoom and demotes under a blown frame budget', () => {
    expect(lodForZoom(13)).toBe('city'); expect(lodForZoom(15)).toBe('neighbourhood'); expect(lodForZoom(17)).toBe('street')
    const c = new LodController(20)
    expect(c.lod(17)).toBe('street')
    for (let i = 0; i < 30; i++) c.report(40)
    expect(c.lod(17)).toBe('neighbourhood')
    for (let i = 0; i < 180; i++) c.report(5)
    expect(c.lod(17)).toBe('street')
  })
})
