import type { IntelligenceModule, IntelligenceContext, FlowReport, EdgeFlow, CongestionLevel } from '../types'
import type { SimSnapshot } from '../../engine/simulation/snapshot'

function level(c: number): CongestionLevel {
  return c < 0.25 ? 'free' : c < 0.5 ? 'slow' : c < 0.8 ? 'congested' : 'jammed'
}

/** Per-edge flow and congestion, derived from observed/simulated vehicle states. */
export const TrafficFlowAnalyzer: IntelligenceModule<SimSnapshot, FlowReport> = {
  id: 'traffic-flow/1',
  async process(snapshot, ctx: IntelligenceContext) {
    const edges = new Map<string, EdgeFlow>()
    let sumRatio = 0, n = 0, congested = 0, vehicles = 0, observedEdges = 0
    const observed = ctx.world.observedFlow
    const counts = new Map<string, number>()
    for (const [edgeId, count, meanSpeed] of snapshot.edgeStats) {
      counts.set(edgeId, count)
      const edge = ctx.graph.edge(edgeId)
      if (!edge) continue
      const obs = observed.get(edgeId)
      if (obs) continue // observed edges are handled below, whatever the simulation says
      const ratio = edge.speedLimit > 0 ? meanSpeed / edge.speedLimit : 1
      // Congestion needs both low speed and presence: a single parked car is not a jam.
      const presence = Math.min(1, count / Math.max(1, (edge.length / (12 * ctx.unitPerMetre)) * edge.lanes))
      const congestion = Math.max(0, Math.min(1, (1 - Math.min(1, ratio)) * (0.4 + 0.6 * presence)))
      edges.set(edgeId, { edgeId, count, meanSpeed, speedRatio: ratio, congestion, level: level(congestion), source: 'simulation', observed: false })
      sumRatio += ratio; n++; vehicles += count
      if (congestion >= 0.5) congested++
    }
    // Observed levels (e.g. TomTom relative speed) take precedence over anything simulated.
    for (const [edgeId, obs] of observed) {
      const edge = ctx.graph.edge(edgeId)
      if (!edge) continue
      const ratio = Math.max(0, Math.min(1.2, obs.level))
      const congestion = Math.max(0, Math.min(1, 1 - Math.min(1, ratio)))
      const count = counts.get(edgeId) ?? 0
      edges.set(edgeId, { edgeId, count, meanSpeed: ratio * edge.speedLimit, speedRatio: ratio, congestion, level: level(congestion), source: obs.source, observed: true })
      sumRatio += ratio; n++; observedEdges++
      if (congestion >= 0.5) congested++
    }
    return {
      time: snapshot.time,
      edges,
      meanSpeedRatio: n ? sumRatio / n : 1,
      congestedShare: n ? congested / n : 0,
      vehicleCount: vehicles,
      observedEdges,
      evidence: { classification: 'derived', source: observedEdges > 0 ? `${ctx.world.observedFlowMeta?.source ?? 'feed'}+atlas.simulation` : snapshot.classification === 'simulated' ? 'atlas.simulation' : 'feed', model: 'traffic-flow/2', timestamp: snapshot.time, confidence: observedEdges > 0 ? 0.85 : 0.8 },
    }
  },
}
