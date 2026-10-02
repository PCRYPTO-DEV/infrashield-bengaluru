import { describe, it, expect } from 'vitest'
import { WorldModel } from '../engine/world/WorldModel'
import { TimeMachine } from '../data/realtime/timeMachine'
import { chunkAt, FRAME } from './helpers'
import { localToLngLat } from '../geo/projection/frame'

function world() { const w = new WorldModel(FRAME); w.addChunk(chunkAt(0, 0, 'tm')); return w }

describe('time machine', () => {
  it('shows the memory for a past instant on the edges the live feed matched, and a labelled prediction for the future', async () => {
    const w = world()
    const edge = [...w.graph.edges.values()].find((e) => e.length > 15)!, ep = w.graph.endpoints(edge)!
    const mid = localToLngLat(w.frame, { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 })
    const edgeSegment = new Map([[edge.id, 'seg-1'], [w.graph.reverseId(edge), 'seg-1']])
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      const past = url.includes('/api/history/at')
      const body = past
        ? { at: 1, kind: 'recorded', flow: { segments: [{ segment: 'seg-1', level: 0.3, lng: mid.lng, lat: mid.lat }], count: 1 }, incidents: [{ id: 'i1', ts: 1, kind: 'collision', severity: 0.7, lng: mid.lng, lat: mid.lat, description: 'pile-up', firstSeen: 0 }], coverage: { from: 0, to: 1, segments: 12, readings: 40 }, evidence: { classification: 'observed', source: 'atlas-memory', timestamp: 1, confidence: 1, model: 'kept' } }
        : { at: 2, kind: 'predicted', flow: { segments: [{ segment: 'seg-1', level: 0.8, lng: mid.lng, lat: mid.lat, confidence: 0.5 }], count: 1 }, incidents: [], coverage: { from: 0, to: 1, segments: 12, readings: 40 }, evidence: { classification: 'predicted', source: 'atlas-memory', timestamp: 1, confidence: 0.5, model: 'usual' } }
      return { ok: true, json: async () => body } as Response
    }) as unknown as typeof fetch
    const tm = new TimeMachine(w, () => edgeSegment, 'http://x', fetchImpl)
    const view = { minX: -500, minY: -500, maxX: 500, maxY: 500 }
    expect(await tm.show('past', 3_600_000, view)).toBe(true)
    expect(w.observedFlow.get(edge.id)?.level).toBeCloseTo(0.3, 6)
    expect(w.observedFlowMeta?.source).toBe('memory')
    expect(w.liveIncidents.length).toBe(1); expect(w.liveIncidents[0].properties.edgeId).toBeTruthy()
    expect(tm.state.kind).toBe('past'); expect(tm.state.count).toBe(2); expect(tm.state.roadsRemembered).toBe(12)
    // the same instant and view again is free
    expect(await tm.show('past', 3_600_000 + 60_000, view)).toBe(false)
    expect(calls.length).toBe(1)
    expect(await tm.show('future', 9_000_000, view)).toBe(true)
    expect(w.observedFlowMeta?.source).toBe('forecast'); expect(w.observedFlow.get(edge.id)?.level).toBeCloseTo(0.8, 6)
    expect(w.liveIncidents.length).toBe(0); expect(tm.state.confidence).toBe(0.5)
    tm.reset(); expect(tm.state.kind).toBe(null)
  })
})
