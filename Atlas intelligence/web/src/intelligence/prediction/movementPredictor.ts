import type { IntelligenceModule, Prediction } from '../types'
import type { AgentView } from '../../engine/world/WorldModel'
import type { GraphEdge } from '../../engine/world/chunkTypes'
import type { WorldPoint } from '../../geo/projection/mercator'

export interface PredictorInput { agent: AgentView; horizonS?: number }

/**
 * Baseline movement prediction.
 *  1. constant-velocity extrapolation (always available)
 *  2. road-constrained: follow the current edge, continue straight where
 *     possible, branch with probabilities at intersections.
 * Uncertainty grows with time: the envelope radius is a function of
 * horizon and recent speed variance. Nothing here is a certainty and the
 * renderer draws it as ghost geometry.
 */
export const MovementPredictor: IntelligenceModule<PredictorInput, Prediction> = {
  id: 'movement-predictor/1',
  async process({ agent, horizonS = 60 }, ctx) {
    const upm = ctx.unitPerMetre
    const speed = Math.max(agent.speed, 0.2 * upm)
    const sdSpeed = speedVariance(agent)
    const edge = ctx.graph.edge(agent.edgeId)
    const ep = edge && ctx.graph.endpoints(edge)
    const envelope: number[] = []
    for (let s = 0; s <= horizonS; s++) envelope.push((1.5 + 0.12 * s + sdSpeed * s * 0.5) * upm)

    if (!edge || !ep) {
      const path: WorldPoint[] = []
      for (let s = 0; s <= horizonS; s++) path.push({ x: agent.x + Math.cos(agent.heading) * speed * s, y: agent.y + Math.sin(agent.heading) * speed * s })
      return { agentId: agent.id, method: 'constant-velocity', horizonS, path, envelope, confidence: 0.35, alternatives: [], evidence: { classification: 'predicted', model: 'constant-velocity/1', timestamp: ctx.time, confidence: 0.35 } }
    }

    // Road-constrained most-likely path.
    const main = walk(ctx, agent, edge, ep, speed, horizonS, (outs, cur) => pickStraight(outs, cur))
    const alternatives: Prediction['alternatives'] = []
    // One alternative: first turn instead of straight.
    const alt = walk(ctx, agent, edge, ep, speed, horizonS, (outs, cur) => pickTurn(outs, cur))
    if (alt.branched) alternatives.push({ path: alt.path, probability: 0.3 })
    const confidence = Math.max(0.2, 0.85 - 0.004 * horizonS - sdSpeed * 0.3) * (main.branched ? 0.8 : 1)
    return { agentId: agent.id, method: 'road-constrained', horizonS, path: main.path, envelope, confidence, alternatives, evidence: { classification: 'predicted', model: 'road-constrained/1', timestamp: ctx.time, confidence } }
  },
}

function speedVariance(a: AgentView): number {
  if (a.history.length < 4) return 0.4
  const sp = a.history.slice(-10).map((h) => h.speed)
  const m = sp.reduce((s, v) => s + v, 0) / sp.length
  return Math.sqrt(sp.reduce((s, v) => s + (v - m) ** 2, 0) / sp.length) / Math.max(1, m)
}

function pickStraight(outs: GraphEdge[], cur: GraphEdge): GraphEdge | undefined {
  const reverse = `${cur.to}>${cur.from}`
  const fwd = outs.filter((e) => e.id !== reverse)
  return fwd.find((e) => e.axis === cur.axis) ?? fwd[0]
}
function pickTurn(outs: GraphEdge[], cur: GraphEdge): GraphEdge | undefined {
  const reverse = `${cur.to}>${cur.from}`
  const fwd = outs.filter((e) => e.id !== reverse)
  return fwd.find((e) => e.axis !== cur.axis)
}

function walk(ctx: Parameters<typeof MovementPredictor.process>[1], agent: AgentView, edge: GraphEdge, ep: { a: WorldPoint; b: WorldPoint }, speed: number, horizonS: number, choose: (outs: GraphEdge[], cur: GraphEdge) => GraphEdge | undefined): { path: WorldPoint[]; branched: boolean } {
  const path: WorldPoint[] = [{ x: agent.x, y: agent.y }]
  let cur = edge, a = ep.a, b = ep.b
  const len = cur.length || 1
  let t = Math.max(0, Math.min(1, ((agent.x - a.x) * (b.x - a.x) + (agent.y - a.y) * (b.y - a.y)) / (len * len)))
  let branched = false
  for (let s = 1; s <= horizonS; s++) {
    let advance = Math.min(speed, cur.speedLimit) * 1
    while (advance > 0) {
      const remain = (1 - t) * cur.length
      if (advance < remain) { t += advance / cur.length; advance = 0; break }
      advance -= remain
      const next = choose(ctx.graph.outEdges(cur.to), cur)
      const nep = next && ctx.graph.endpoints(next)
      if (!next || !nep) { t = 1; advance = 0; break }
      if (next.axis !== cur.axis) branched = true
      cur = next; a = nep.a; b = nep.b; t = 0
    }
    path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return { path, branched }
}
