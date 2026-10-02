import type { IntelligenceModule, DensityField, DensityCell } from '../types'
import type { AgentView } from '../../engine/world/WorldModel'

export const DENSITY_CELL_M = 60

/** Spatial aggregation of agents into a coarse grid (derived). */
export const DensityAnalyzer: IntelligenceModule<{ agents: Iterable<AgentView>; time: number }, DensityField> = {
  id: 'density/1',
  async process(input, ctx) {
    const cellSize = DENSITY_CELL_M * ctx.unitPerMetre
    const cells = new Map<string, DensityCell>()
    let max = 0
    for (const a of input.agents) {
      const cx = Math.floor(a.x / cellSize), cy = Math.floor(a.y / cellSize)
      const key = `${cx},${cy}`
      let c = cells.get(key)
      if (!c) { c = { key, x: (cx + 0.5) * cellSize, y: (cy + 0.5) * cellSize, vehicles: 0, pedestrians: 0, density: 0 }; cells.set(key, c) }
      if (a.kind === 'vehicle') c.vehicles++; else c.pedestrians++
      c.density = c.vehicles + c.pedestrians * 0.6
      if (c.density > max) max = c.density
    }
    return { time: input.time, cellSize, cells, max, evidence: { classification: 'derived', model: 'density/1', timestamp: input.time, confidence: 0.85 } }
  },
}
