import type { GraphEdge, GraphNode, RoadGraphData } from '../world/chunkTypes'
import type { IncidentProperties, TrafficSignalProperties } from '../../entities/types'

export interface SimChunkPayload {
  key: string
  graph: RoadGraphData
  meta: { density: number; vehicleBudget: number; pedestrianBudget: number }
  incidents: Array<{ id: string; props: IncidentProperties }>
}

/**
 * Mutable, chunk-aware road graph. Chunks add and remove their edges;
 * boundary nodes shared between neighbouring chunks are reference counted
 * so the graph stays connected while either neighbour is resident.
 */
export class RoadGraph {
  readonly nodes = new Map<string, GraphNode>()
  readonly edges = new Map<string, GraphEdge>()
  readonly out = new Map<string, string[]>()
  readonly signals = new Map<string, TrafficSignalProperties>()
  readonly edgeChunk = new Map<string, string>()
  readonly chunkEdges = new Map<string, string[]>()
  readonly incidents = new Map<string, { id: string; props: IncidentProperties }>()
  private nodeRefs = new Map<string, number>()
  private incidentChunk = new Map<string, string>()

  addChunk(payload: SimChunkPayload): void {
    if (this.chunkEdges.has(payload.key)) this.removeChunk(payload.key)
    const ids: string[] = []
    for (const n of payload.graph.nodes) {
      const refs = (this.nodeRefs.get(n.id) ?? 0) + 1
      this.nodeRefs.set(n.id, refs)
      const existing = this.nodes.get(n.id)
      if (!existing) this.nodes.set(n.id, { ...n })
      else if (n.signal) existing.signal = true
    }
    for (const e of payload.graph.edges) {
      if (this.edges.has(e.id)) continue
      this.edges.set(e.id, e)
      this.edgeChunk.set(e.id, payload.key)
      ids.push(e.id)
      const list = this.out.get(e.from) ?? []
      list.push(e.id)
      this.out.set(e.from, list)
    }
    for (const s of payload.graph.signals) this.signals.set(s.nodeId, s)
    for (const inc of payload.incidents) { this.incidents.set(inc.id, inc); this.incidentChunk.set(inc.id, payload.key) }
    this.chunkEdges.set(payload.key, ids)
  }

  removeChunk(key: string): void {
    const ids = this.chunkEdges.get(key)
    if (!ids) return
    for (const id of ids) {
      const e = this.edges.get(id)
      if (!e) continue
      this.edges.delete(id)
      this.edgeChunk.delete(id)
      const list = this.out.get(e.from)
      if (list) { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); if (list.length === 0) this.out.delete(e.from) }
      for (const n of [e.from, e.to]) this.releaseNode(n)
    }
    for (const [incId, ck] of [...this.incidentChunk]) if (ck === key) { this.incidents.delete(incId); this.incidentChunk.delete(incId) }
    this.chunkEdges.delete(key)
  }

  private releaseNode(id: string): void {
    // Nodes are released when no edge references them at all.
    for (const e of this.edges.values()) if (e.from === id || e.to === id) return
    this.nodes.delete(id)
    this.nodeRefs.delete(id)
    this.signals.delete(id)
  }

  edge(id: string): GraphEdge | undefined { return this.edges.get(id) }
  node(id: string): GraphNode | undefined { return this.nodes.get(id) }
  outEdges(nodeId: string): GraphEdge[] { return (this.out.get(nodeId) ?? []).map((id) => this.edges.get(id)!).filter(Boolean) }

  reverseId(e: GraphEdge): string { return `${e.to}>${e.from}` }

  /** Edge endpoints as points. */
  endpoints(e: GraphEdge): { a: GraphNode; b: GraphNode } | undefined {
    const a = this.nodes.get(e.from), b = this.nodes.get(e.to)
    return a && b ? { a, b } : undefined
  }

  /** Active incidents at a given sim time, keyed by edge id (both directions). */
  activeIncidentsByEdge(timeMs: number): Map<string, IncidentProperties> {
    const m = new Map<string, IncidentProperties>()
    for (const inc of this.incidents.values()) {
      const p = inc.props
      if (timeMs >= p.startTime && timeMs <= p.endTime) {
        m.set(p.edgeId, p)
        const e = this.edges.get(p.edgeId)
        if (e) m.set(this.reverseId(e), p)
      }
    }
    return m
  }

  get edgeCount(): number { return this.edges.size }
  get nodeCount(): number { return this.nodes.size }
}
