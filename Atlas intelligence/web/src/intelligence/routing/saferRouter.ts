import type { RoadGraph } from '../../engine/simulation/roadGraph'
import type { RiskReport, FlowReport } from '../types'
import type { WorldPoint } from '../../geo/projection/mercator'
import type { EvidenceMetadata } from '../../entities/types'

export interface RouteWeights {
  /** α travel time (per second) */
  travelTime: number
  /** β incident risk */
  incidentRisk: number
  /** γ congestion */
  congestion: number
  /** δ pedestrian risk */
  pedestrianRisk: number
  /** ε environmental cost (longer roads, construction) */
  environmental: number
}

export const DEFAULT_WEIGHTS: RouteWeights = { travelTime: 1, incidentRisk: 120, congestion: 60, pedestrianRisk: 40, environmental: 20 }

export interface RouteResult {
  edgeIds: string[]
  nodeIds: string[]
  path: WorldPoint[]
  totalCost: number
  /** seconds, at current estimated speeds */
  travelTimeS: number
  distanceM: number
  factors: { travelTime: number; incidentRisk: number; congestion: number; pedestrianRisk: number; environmental: number }
  /** Human-readable, careful wording: never claims safety. */
  explanation: string[]
  evidence: EvidenceMetadata
}

export interface RouterInputs { graph: RoadGraph; risk?: RiskReport; flow?: FlowReport; unitPerMetre: number; time: number }

/**
 * C(route) = α·travelTime + β·incidentRisk + γ·congestion + δ·pedestrianRisk + ε·environmentalCost
 * Dijkstra over the directed road graph. Weights are configurable.
 */
export function routeBetween(inputs: RouterInputs, fromNode: string, toNode: string, weights: RouteWeights = DEFAULT_WEIGHTS): RouteResult | null {
  const { graph, risk, flow, unitPerMetre } = inputs
  const dist = new Map<string, number>()
  const prev = new Map<string, { node: string; edge: string }>()
  const done = new Set<string>()
  dist.set(fromNode, 0)
  // Simple binary-heap-free Dijkstra: graph sizes here are a few thousand edges.
  const open: Array<[number, string]> = [[0, fromNode]]
  const edgeCost = (edgeId: string) => {
    const e = graph.edge(edgeId)!
    const f = flow?.edges.get(edgeId)
    const speed = f && f.count > 0 ? Math.max(0.5 * unitPerMetre, f.meanSpeed) : e.speedLimit
    const tt = e.length / speed
    const r = risk?.edges.get(edgeId)
    const factors = {
      travelTime: tt,
      incidentRisk: (r?.factors.incident ?? 0) * (e.length / (100 * unitPerMetre)),
      congestion: (r?.factors.congestion ?? f?.congestion ?? 0) * (e.length / (100 * unitPerMetre)),
      pedestrianRisk: (r?.factors.pedestrian ?? 0) * (e.length / (100 * unitPerMetre)),
      environmental: (e.length / (1000 * unitPerMetre)) * (1 + (r?.factors.construction ?? 0)),
    }
    const cost = weights.travelTime * factors.travelTime + weights.incidentRisk * factors.incidentRisk + weights.congestion * factors.congestion + weights.pedestrianRisk * factors.pedestrianRisk + weights.environmental * factors.environmental
    return { cost, factors, tt }
  }
  while (open.length) {
    open.sort((a, b) => a[0] - b[0])
    const [d, u] = open.shift()!
    if (done.has(u)) continue
    done.add(u)
    if (u === toNode) break
    for (const e of graph.outEdges(u)) {
      const { cost } = edgeCost(e.id)
      const nd = d + cost
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { node: u, edge: e.id }); open.push([nd, e.to]) }
    }
  }
  if (!dist.has(toNode)) return null
  const edgeIds: string[] = [], nodeIds: string[] = [toNode]
  let cur = toNode
  while (cur !== fromNode) { const p = prev.get(cur); if (!p) return null; edgeIds.unshift(p.edge); nodeIds.unshift(p.node); cur = p.node }
  const path = nodeIds.map((n) => { const node = graph.node(n)!; return { x: node.x, y: node.y } })
  const factors = { travelTime: 0, incidentRisk: 0, congestion: 0, pedestrianRisk: 0, environmental: 0 }
  let travelTimeS = 0, distance = 0
  for (const id of edgeIds) {
    const c = edgeCost(id)
    factors.travelTime += c.factors.travelTime; factors.incidentRisk += c.factors.incidentRisk; factors.congestion += c.factors.congestion; factors.pedestrianRisk += c.factors.pedestrianRisk; factors.environmental += c.factors.environmental
    travelTimeS += c.tt; distance += graph.edge(id)!.length
  }
  const explanation = [
    `Route chosen by weighted cost (α=${weights.travelTime}, β=${weights.incidentRisk}, γ=${weights.congestion}, δ=${weights.pedestrianRisk}, ε=${weights.environmental}).`,
    `Estimated travel time ${Math.round(travelTimeS / 60)} min over ${(distance / unitPerMetre / 1000).toFixed(2)} km at currently estimated speeds.`,
    factors.incidentRisk > 0 ? `Passes ${factors.incidentRisk.toFixed(2)} incident-weighted segments.` : 'Avoids segments with active reported incidents.',
    `Congestion exposure ${factors.congestion.toFixed(2)}, pedestrian exposure ${factors.pedestrianRisk.toFixed(2)} (derived indicators).`,
    'Lower estimated risk according to currently available signals; this is not a guarantee of safety.',
  ]
  return { edgeIds, nodeIds, path, totalCost: dist.get(toNode)!, travelTimeS, distanceM: distance / unitPerMetre, factors, explanation, evidence: { classification: 'derived', model: 'safer-router/1', timestamp: inputs.time, confidence: 0.6 } }
}

/** Nearest graph node to a local point. */
export function nearestNode(graph: RoadGraph, p: WorldPoint): string | undefined {
  let best: string | undefined, bd = Infinity
  for (const n of graph.nodes.values()) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n.id } }
  return best
}
