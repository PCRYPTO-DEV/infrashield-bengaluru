import type { PRNG } from '../../seed/prng'
import type { GraphEdge, GraphNode, RenderSignal } from '../../world/chunkTypes'
import type { TrafficSignalProperties } from '../../../entities/types'

export interface SignalPlan { node: GraphNode; props: TrafficSignalProperties }

/**
 * Traffic signal grammar: signalise intersections with degree >= 3 where
 * an arterial or collector meets anything, with a deterministic cycle and
 * offset so phases are reproducible from simulation time alone.
 */
export function generateTrafficSignals(nodes: Map<string, GraphNode>, edges: GraphEdge[], rng: PRNG): SignalPlan[] {
  const degree = new Map<string, Set<string>>()
  const hasMajor = new Map<string, boolean>()
  for (const e of edges) {
    for (const n of [e.from, e.to]) {
      if (!degree.has(n)) degree.set(n, new Set())
      degree.get(n)!.add(e.from === n ? e.to : e.from)
      if (e.roadClass === 'arterial' || e.roadClass === 'collector') hasMajor.set(n, true)
    }
  }
  const out: SignalPlan[] = []
  for (const node of nodes.values()) {
    const d = degree.get(node.id)?.size ?? 0
    if (d < 3) continue
    const p = hasMajor.get(node.id) ? (d === 4 ? 0.8 : 0.4) : 0.1
    if (!rng.chance(p)) continue
    node.signal = true
    const cycle = rng.choice([60, 75, 90])
    out.push({
      node,
      props: {
        nodeId: node.id,
        cycleSeconds: cycle,
        offsetSeconds: rng.int(0, cycle),
        greenNorthSouthSeconds: Math.round(cycle * rng.range(0.4, 0.6)),
      },
    })
  }
  return out
}

export function toRenderSignals(plans: SignalPlan[]): RenderSignal[] {
  return plans.map((p) => ({ id: `s:${p.node.id}`, x: p.node.x, y: p.node.y }))
}

/**
 * Signal phase at a simulation time (seconds). Returns which axis is green.
 * Pure function of (props, time): the same instant always yields the same
 * phase in every worker and every replay.
 */
export function signalPhase(props: TrafficSignalProperties, timeSeconds: number): 'ns' | 'ew' | 'all-red' {
  const t = ((timeSeconds + props.offsetSeconds) % props.cycleSeconds + props.cycleSeconds) % props.cycleSeconds
  const amber = 3
  if (t < props.greenNorthSouthSeconds - amber) return 'ns'
  if (t < props.greenNorthSouthSeconds) return 'all-red'
  if (t < props.cycleSeconds - amber) return 'ew'
  return 'all-red'
}
