import type { IntelligenceModule, Anomaly, DensityField, FlowReport } from '../types'
import type { AgentView } from '../../engine/world/WorldModel'
import type { MonitoringZone } from '../../zones/types'
import { zoneContains } from '../../zones/geometry'

export interface AnomalyInput {
  time: number
  agents: Iterable<AgentView>
  flow: FlowReport
  density: DensityField
  zones: MonitoringZone[]
}

const STOP_SECONDS = 25
const DWELL_SECONDS = 120

/**
 * Explainable abnormality detection. Every anomaly carries the concrete
 * measurements that triggered it; there is no opaque score.
 */
export const AnomalyDetector: IntelligenceModule<AnomalyInput, Anomaly[]> = {
  id: 'anomaly/1',
  async process(input, ctx) {
    const out: Anomaly[] = []
    const t = input.time
    const upm = ctx.unitPerMetre
    const graph = ctx.graph
    const incidents = graph.activeIncidentsByEdge(t)

    for (const a of input.agents) {
      const edge = graph.edge(a.edgeId)
      const ep = edge && graph.endpoints(edge)
      if (!edge || !ep) continue

      if (a.kind === 'vehicle') {
        // 1. Wrong-way / wrong side: lateral position relative to edge direction (left-hand traffic).
        const dx = ep.b.x - ep.a.x, dy = ep.b.y - ep.a.y
        const len = edge.length || 1
        const ux = dx / len, uy = dy / len
        const rx = a.x - ep.a.x, ry = a.y - ep.a.y
        const lateral = rx * uy - ry * ux // + means left of travel in y-down space
        if (lateral < -0.8 * upm && a.speed > 1 * upm) {
          out.push(mk('wrong_way', `wrongway:${a.id}`, 0.8, 0.75, t, a, [`lateral offset ${(lateral / upm).toFixed(1)} m (expected > 0, left-hand traffic)`, `speed ${(a.speed / upm).toFixed(1)} m/s on ${edge.roadId}`], 'Vehicle is travelling on the wrong side of the carriageway relative to the edge direction.'))
        }
        // 2. Unusual stopping: stopped away from signals and incidents.
        const stoppedFor = stoppedDuration(a, t)
        if (stoppedFor >= STOP_SECONDS) {
          const nearSignal = (graph.node(edge.to)?.signal && (1 - agentT(a, ep, len)) * len < 25 * upm)
          const nearIncident = incidents.has(edge.id)
          if (!nearSignal && !nearIncident) {
            out.push(mk('unusual_stop', `stop:${a.id}`, Math.min(1, stoppedFor / 120), 0.7, t, a, [`stationary for ${Math.round(stoppedFor)} s`, 'no signal within 25 m ahead', 'no active incident on this edge'], 'Vehicle stopped mid-block with no signal or reported incident nearby.'))
          }
        }
      } else {
        // 5/6. Pedestrian in a restricted zone; long dwell inside a zone.
        for (const z of input.zones) {
          if (!zoneContains(z, a)) continue
          if (z.restricted) out.push(mk('restricted_zone_entry', `zone:${z.id}:${a.id}`, 0.9, 0.9, t, a, [`inside zone "${z.name}" marked restricted`], 'Pedestrian present inside a user-defined restricted zone.'))
          const dwell = stoppedDuration(a, t)
          if (dwell >= DWELL_SECONDS) out.push(mk('long_dwell', `dwell:${z.id}:${a.id}`, Math.min(1, dwell / 600), 0.65, t, a, [`stationary ${Math.round(dwell)} s inside "${z.name}"`], 'Unusually long dwell inside a monitored zone.'))
        }
      }
    }

    // 3. Rapid density increase vs the previous field (~ last 30–60 s).
    const prev = ctx.history.densities.length >= 2 ? ctx.history.densities[ctx.history.densities.length - 2] : undefined
    if (prev) {
      for (const c of input.density.cells.values()) {
        const before = prev.cells.get(c.key)?.density ?? 0
        if (c.density >= 8 && c.density >= before * 2.2 + 2) {
          out.push({ id: `surge:${c.key}:${Math.floor(t / 60000)}`, type: 'density_surge', severity: Math.min(1, c.density / 20), confidence: 0.6, timestamp: t, location: { x: c.x, y: c.y }, entityIds: [], evidence: [`density ${c.density.toFixed(1)} now vs ${before.toFixed(1)} at ${new Date(prev.time).toISOString().slice(11, 19)}`], explanation: 'Agent density in this cell rose sharply within a minute.', meta: { classification: 'derived', model: 'anomaly/1', timestamp: t, confidence: 0.6 } })
        }
      }
    }

    // 4 & 7. Speed drop vs free-flow baseline; flow diverging from rolling baseline.
    const hist = ctx.history.flows
    for (const f of input.flow.edges.values()) {
      const edge = graph.edge(f.edgeId)
      const ep = edge && graph.endpoints(edge)
      if (!edge || !ep) continue
      const mid = { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 }
      if (f.count >= 3 && f.speedRatio < 0.35 && !incidents.has(f.edgeId)) {
        out.push({ id: `speed:${f.edgeId}:${Math.floor(t / 120000)}`, type: 'speed_drop', severity: 1 - f.speedRatio, confidence: 0.7, timestamp: t, location: mid, entityIds: [edge.roadId], evidence: [`${f.count} vehicles at mean ${(f.meanSpeed / upm).toFixed(1)} m/s`, `free-flow baseline ${(edge.speedLimit / upm).toFixed(1)} m/s (ratio ${f.speedRatio.toFixed(2)})`, 'no reported incident on this edge'], explanation: 'Traffic on this segment is far below its free-flow speed without a reported cause.', meta: { classification: 'derived', model: 'anomaly/1', timestamp: t, confidence: 0.7 } })
      }
      if (hist.length >= 6) {
        const counts = hist.map((h) => h.edges.get(f.edgeId)?.count ?? 0)
        const mean = counts.reduce((s, v) => s + v, 0) / counts.length
        const sd = Math.sqrt(counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length)
        const z = sd > 0.5 ? (f.count - mean) / sd : 0
        if (Math.abs(z) > 2.5 && f.count >= 4) {
          out.push({ id: `flow:${f.edgeId}:${Math.floor(t / 120000)}`, type: 'flow_divergence', severity: Math.min(1, Math.abs(z) / 5), confidence: 0.55, timestamp: t, location: mid, entityIds: [edge.roadId], evidence: [`${f.count} vehicles now vs rolling mean ${mean.toFixed(1)} ± ${sd.toFixed(1)} over ${hist.length} samples`, `z-score ${z.toFixed(1)}`], explanation: z > 0 ? 'Vehicle count on this segment is well above its recent baseline.' : 'Vehicle count on this segment dropped well below its recent baseline.', meta: { classification: 'derived', model: 'anomaly/1', timestamp: t, confidence: 0.55 } })
        }
      }
    }
    return out
  },
}

function mk(type: Anomaly['type'], id: string, severity: number, confidence: number, t: number, a: AgentView, evidence: string[], explanation: string): Anomaly {
  return { id, type, severity, confidence, timestamp: t, location: { x: a.x, y: a.y }, entityIds: [`agent:${a.id}`], evidence, explanation, meta: { classification: 'derived', model: 'anomaly/1', timestamp: t, confidence } }
}

/** Seconds the agent has been (near) stationary, from its sampled history. */
export function stoppedDuration(a: AgentView, now: number): number {
  if (a.speed > 0.3) return 0
  let since = now
  for (let i = a.history.length - 1; i >= 0; i--) {
    const s = a.history[i]
    if (s.speed > 0.3 || Math.hypot(s.x - a.x, s.y - a.y) > 1.5) break
    since = s.t
  }
  return (now - since) / 1000
}

function agentT(a: AgentView, ep: { a: { x: number; y: number }; b: { x: number; y: number } }, len: number): number {
  const dx = ep.b.x - ep.a.x, dy = ep.b.y - ep.a.y
  return Math.max(0, Math.min(1, ((a.x - ep.a.x) * dx + (a.y - ep.a.y) * dy) / (len * len)))
}
