import type { IntelligenceModule, ActivityReport, DensityField, FlowReport } from '../types'
import type { BuildingProperties } from '../../entities/types'

/**
 * Activity = people + movement + land-use affinity for the time of day.
 * The land-use term is a prior (offices by day, mixed/commercial by evening),
 * blended with the derived density so quiet offices at night fade out.
 */
export const UrbanActivityAnalyzer: IntelligenceModule<{ density: DensityField; flow: FlowReport; time: number }, ActivityReport> = {
  id: 'urban-activity/1',
  async process({ density, flow, time }, ctx) {
    const hour = new Date(time).getUTCHours() + 5.5 // IST-ish local hour for the demo region
    const h = ((hour % 24) + 24) % 24
    const officeFactor = h >= 9 && h <= 18 ? 1 : 0.2
    const eveningFactor = h >= 17 && h <= 23 ? 1 : 0.5
    const cells = new Map<string, { x: number; y: number; activity: number }>()
    let overall = 0
    const edgeFlowAt = (x: number, y: number) => {
      // nearest road edge flow: cheap approximation using the world index
      const road = ctx.world.nearestRoad({ x, y }, density.cellSize)
      if (!road) return 0
      const ids = (road.entity.properties as { edgeIds?: string[] }).edgeIds ?? []
      let s = 0, n = 0
      for (const id of ids) { const f = flow.edges.get(id); if (f) { s += f.count; n++ } }
      return n ? s / n : 0
    }
    for (const c of density.cells.values()) {
      const nearby = ctx.world.entitiesIn({ minX: c.x - density.cellSize / 2, minY: c.y - density.cellSize / 2, maxX: c.x + density.cellSize / 2, maxY: c.y + density.cellSize / 2 })
      let prior = 0.2
      for (const e of nearby) {
        if (e.entity.type === 'building') {
          const use = (e.entity.properties as BuildingProperties).landUse
          prior += use === 'office' ? 0.25 * officeFactor : use === 'commercial' || use === 'mixed' ? 0.25 * eveningFactor : 0.08
        } else if (e.entity.type === 'transit') prior += 0.4
        else if (e.entity.type === 'park') prior += 0.1
      }
      const people = Math.min(1, c.pedestrians / 8)
      const movement = Math.min(1, (c.vehicles + edgeFlowAt(c.x, c.y)) / 10)
      const activity = Math.min(1, 0.45 * people + 0.3 * movement + 0.25 * Math.min(1, prior))
      cells.set(c.key, { x: c.x, y: c.y, activity })
      overall += activity
    }
    const hotspots = [...cells.values()].filter((c) => c.activity > 0.55).sort((a, b) => b.activity - a.activity).slice(0, 8)
      .map((c) => ({ x: c.x, y: c.y, score: c.activity, reason: 'High pedestrian presence and vehicle movement in this cell' }))
    return { time, cells, hotspots, overall: cells.size ? overall / cells.size : 0, evidence: { classification: 'derived', model: 'urban-activity/1', timestamp: time, confidence: 0.7 } }
  },
}
