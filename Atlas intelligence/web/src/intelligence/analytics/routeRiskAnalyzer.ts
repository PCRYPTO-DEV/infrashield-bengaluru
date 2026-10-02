import type { IntelligenceModule, RiskReport, EdgeRisk, FlowReport, DensityField } from '../types'

/**
 * Per-edge risk indicators from currently available signals. The output is
 * explicitly a *derived indicator*, never a verdict about safety.
 */
export const RouteRiskAnalyzer: IntelligenceModule<{ flow: FlowReport; density: DensityField; time: number }, RiskReport> = {
  id: 'route-risk/1',
  async process({ flow, density, time }, ctx) {
    const edges = new Map<string, EdgeRisk>()
    const incidents = ctx.graph.activeIncidentsByEdge(time)
    const constructionCells = new Set<string>()
    for (const ie of ctx.world.entities.values()) {
      if (ie.entity.type !== 'construction') continue
      const cx = Math.floor((ie.bounds.minX + ie.bounds.maxX) / 2 / density.cellSize), cy = Math.floor((ie.bounds.minY + ie.bounds.maxY) / 2 / density.cellSize)
      constructionCells.add(`${cx},${cy}`)
    }
    const nodeRisk = new Map<string, { sum: number; n: number; reasons: Set<string> }>()
    for (const e of ctx.graph.edges.values()) {
      const ep = ctx.graph.endpoints(e)
      if (!ep) continue
      const mid = { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 }
      const cellKey = `${Math.floor(mid.x / density.cellSize)},${Math.floor(mid.y / density.cellSize)}`
      const cell = density.cells.get(cellKey)
      const inc = incidents.get(e.id)
      const factors = {
        incident: inc ? inc.severity : 0,
        congestion: flow.edges.get(e.id)?.congestion ?? 0,
        pedestrian: cell ? Math.min(1, cell.pedestrians / 10) * (e.roadClass === 'arterial' ? 1 : 0.5) : 0,
        construction: constructionCells.has(cellKey) ? 0.5 : 0,
      }
      const risk = Math.min(1, 0.45 * factors.incident + 0.25 * factors.congestion + 0.2 * factors.pedestrian + 0.1 * factors.construction)
      edges.set(e.id, { edgeId: e.id, risk, factors })
      for (const nid of [e.from, e.to]) {
        const r = nodeRisk.get(nid) ?? { sum: 0, n: 0, reasons: new Set<string>() }
        r.sum += risk; r.n++
        if (factors.incident > 0) r.reasons.add(`active ${inc!.kind}`)
        if (factors.congestion > 0.5) r.reasons.add('congested approach')
        if (factors.pedestrian > 0.5) r.reasons.add('high pedestrian presence')
        if (factors.construction > 0) r.reasons.add('construction nearby')
        nodeRisk.set(nid, r)
      }
    }
    const hotspots = [...nodeRisk.entries()].map(([nodeId, r]) => { const n = ctx.graph.node(nodeId)!; return { nodeId, x: n.x, y: n.y, risk: r.sum / r.n, reasons: [...r.reasons] } })
      .filter((h) => h.risk > 0.15).sort((a, b) => b.risk - a.risk).slice(0, 10)
    return { time, edges, hotspots, evidence: { classification: 'derived', model: 'route-risk/1', timestamp: time, confidence: 0.6 } }
  },
}
