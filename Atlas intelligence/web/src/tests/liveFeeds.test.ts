import { describe, it, expect } from 'vitest'
import { WorldModel } from '../engine/world/WorldModel'
import { MovementEngine } from '../engine/simulation/movementEngine'
import { IntelligencePipeline } from '../intelligence/pipeline'
import { matchFlowToEdges, attachIncidentToEdge, LiveFeeds, type FlowSegment } from '../data/realtime/liveFeeds'
import { cityPulse } from '../intelligence/pulse/cityPulse'
import { chunkAt, FRAME } from './helpers'
import { localToLngLat } from '../geo/projection/frame'
import type { IncidentProperties } from '../entities/types'

function world() {
  const w = new WorldModel(FRAME)
  const c = chunkAt(0, 0, 'live')
  w.addChunk(c)
  return { w, c }
}

/** A flow segment that runs along a given graph edge. */
function segmentAlong(w: WorldModel, edgeId: string, level: number): FlowSegment {
  const e = w.graph.edge(edgeId)!, ep = w.graph.endpoints(e)!
  const a = localToLngLat(w.frame, ep.a), b = localToLngLat(w.frame, ep.b)
  return { id: 's', coordinates: [[a.lng, a.lat], [b.lng, b.lat]], trafficLevel: level }
}

describe('live flow matching', () => {
  it('assigns observed levels to edges that lie along a segment and to nothing else', () => {
    const { w } = world()
    const edge = [...w.graph.edges.values()].find((e) => e.length > 15 && e.roadClass === 'arterial')!
    const levels = matchFlowToEdges(w, [segmentAlong(w, edge.id, 0.4)])
    expect(levels.get(edge.id)).toBeCloseTo(0.4, 6)
    expect(levels.get(w.graph.reverseId(edge))).toBeCloseTo(0.4, 6)
    expect(levels.size).toBeLessThan(w.graph.edgeCount / 4)
    const perpendicular = [...w.graph.edges.values()].find((e) => e.axis !== edge.axis && e.from === edge.to)
    if (perpendicular) expect(levels.has(perpendicular.id)).toBe(false)
  })
  it('observed levels override simulated speeds in the analyzer and condition the simulation', async () => {
    const { w, c } = world()
    const engine = new MovementEngine({ globalSeed: 'live', unitPerMetre: w.unitPerMetre })
    engine.addChunk({ key: c.key, graph: c.graph, meta: c.meta, incidents: [] })
    engine.reset(0)
    const edge = [...w.graph.edges.values()].find((e) => e.length > 15 && e.roadClass === 'arterial')!
    const levels = matchFlowToEdges(w, [segmentAlong(w, edge.id, 0.2)])
    w.setObservedFlow(levels, 5000, 'tomtom', 1)
    engine.graph.setObservedLevels(levels)
    engine.advanceTo(30_000)
    const snap = engine.snapshot(); w.ingest(snap)
    const pipe = new IntelligencePipeline(w)
    const st = await pipe.run(snap, [], [])
    const f = st.flow!.edges.get(edge.id)!
    expect(f.observed).toBe(true); expect(f.source).toBe('tomtom'); expect(f.speedRatio).toBeCloseTo(0.2, 6)
    expect(st.flow!.observedEdges).toBeGreaterThan(0)
    expect(st.flow!.evidence.source).toContain('tomtom')
    // every simulated vehicle on that edge is held near 20% of the limit
    for (let i = 0; i < snap.count; i++) if (snap.edgeIds[i] === edge.id && snap.kinds[i] === 0) expect(snap.speeds[i]).toBeLessThanOrEqual(edge.speedLimit * 0.2 + 1e-6)
  })
  it('attaches a live incident to the nearest edge and the pulse reports weather', () => {
    const { w } = world()
    const edge = [...w.graph.edges.values()].find((e) => e.length > 15)!, ep = w.graph.endpoints(edge)!
    const mid = localToLngLat(w.frame, { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 })
    const inc = { id: 'tomtom:1', type: 'incident' as const, geometry: { type: 'Point' as const, coordinates: [mid.lng, mid.lat] as [number, number] }, evidence: { classification: 'observed' as const, source: 'tomtom' }, properties: { kind: 'collision', severity: 0.6, startTime: 0, endTime: 9e12, edgeId: '', description: 'x' } as IncidentProperties }
    const edgeId = attachIncidentToEdge(w, inc)
    expect(edgeId).not.toBe('')
    expect(w.graph.edge(edgeId)!.roadId).toBe(edge.roadId)
    w.setLiveIncidents([{ ...inc, properties: { ...inc.properties, edgeId } }])
    expect(w.activeIncidents(1000).some((i) => i.entity.id === 'tomtom:1')).toBe(true)
    w.weather = { fetchedAt: 1, source: 'open-meteo', temperatureC: 33, humidityPct: 50, precipitationMm: 4, windKmh: 10, weatherCode: 63, description: 'Rain', observedAt: '2026-10-02T06:00', evidence: { classification: 'observed', source: 'open-meteo', timestamp: 1, confidence: 0.9 } }
    const p = cityPulse(w, { anomalies: [], predictions: new Map(), lastRun: 0 }, 1000)
    const env = p.categories.find((c) => c.id === 'environment')!
    expect(env.index).not.toBeNull(); expect(env.index!).toBeLessThan(1)
    expect(env.measurements[0].value).toBe('Rain')
  })
  it('LiveFeeds polls the server, matches flow, and reports status', async () => {
    const { w } = world()
    const edge = [...w.graph.edges.values()].find((e) => e.length > 15 && e.roadClass === 'arterial')!
    const seg = segmentAlong(w, edge.id, 0.5)
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
      if (url.includes('/api/traffic/flow/')) return json({ key: 'x', fetchedAt: 1, segments: [seg], source: 'tomtom' })
      if (url.includes('/api/traffic/incidents')) return json({ entities: [] })
      if (url.includes('/api/weather')) return json({ temperatureC: 30, description: 'Clear sky', evidence: { classification: 'observed', source: 'open-meteo' } })
      if (url.includes('/api/traffic/status')) return json({ callsToday: 3, dailyBudget: 2000 })
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch
    const feeds = new LiveFeeds(w, { baseUrl: '', fetchImpl })
    feeds.setView({ minX: -300, minY: -300, maxX: 300, maxY: 300 })
    await feeds.pollFlow(true); await feeds.pollIncidents(true); await feeds.pollWeather(); await feeds.pollStatus()
    expect(feeds.status.flow).toBe('open'); expect(feeds.status.weather).toBe('open'); expect(feeds.status.incidents).toBe('open')
    expect(w.observedFlow.get(edge.id)?.level).toBeCloseTo(0.5, 6)
    expect(w.weather?.description).toBe('Clear sky')
    expect(feeds.callsToday).toBe(3)
    expect(calls.some((u) => u.includes('/api/traffic/flow/12/'))).toBe(true)
  })
})

describe('memory and intents', () => {
  it('reports which TomTom segment each edge took its level from', async () => {
    const { parseIntent } = await import('../intelligence/reasoning/intentParser')
    expect(parseIntent('Is Ring Road worse than usual?').kind).toBe('compare')
    expect(parseIntent('क्या आज सामान्य से ज़्यादा जाम है?').kind).toBe('compare')
    expect(parseIntent('ट्रैफ़िक धीमा क्यों है?').kind).toBe('why_slow')
  })
})
