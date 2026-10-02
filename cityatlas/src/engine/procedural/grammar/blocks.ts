import type { PRNG } from '../../seed/prng'
import type { Noise } from '../noise'
import type { LandUse } from '../../../entities/types'
import type { RenderBuilding, RenderPark, RenderPoint, RenderBlock } from '../../world/chunkTypes'
import { ROAD_WIDTH } from './roads'

export type BlockUse = LandUse | 'park' | 'construction' | 'transit'

export interface Block {
  x0: number; y0: number; x1: number; y1: number
  use: BlockUse
  density: number
}

export interface CityFields {
  /** 0..1 urban density (tall, dense near the centre) */
  density: (x: number, y: number) => number
  /** 0..1 commercial affinity */
  commercial: (x: number, y: number) => number
  /** 0..1 green affinity */
  green: (x: number, y: number) => number
}

/** City-scale continuous fields, seeded by the global seed only. */
export function createCityFields(noise: Noise, unitPerMetre: number): CityFields {
  const km = 1000 * unitPerMetre
  return {
    density: (x, y) => {
      const r = Math.hypot(x, y) / (6 * km)
      const radial = Math.max(0, 1 - r * 0.75)
      return Math.min(1, 0.25 + 0.55 * radial + 0.35 * (noise.fbm(x / (2.5 * km), y / (2.5 * km), 3) - 0.5))
    },
    commercial: (x, y) => noise.fbm(x / (1.2 * km) + 40, y / (1.2 * km) + 40, 3),
    green: (x, y) => noise.fbm(x / (0.9 * km) + 90, y / (0.9 * km) + 90, 2),
  }
}

/** Decide what each cell between road lines becomes. */
export function planBlocks(xs: number[], ys: number[], fields: CityFields, rng: PRNG, unitPerMetre: number): Block[] {
  const blocks: Block[] = []
  const minBlock = 40 * unitPerMetre
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1]
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const density = fields.density(cx, cy)
      const w = x1 - x0, h = y1 - y0
      let use: BlockUse
      if (w < minBlock || h < minBlock) use = 'park'
      else if (fields.green(cx, cy) > 0.66 && rng.chance(0.7)) use = 'park'
      else if (rng.chance(0.035)) use = 'construction'
      else if (density > 0.55 && rng.chance(0.05)) use = 'transit'
      else {
        const c = fields.commercial(cx, cy)
        if (c > 0.62 && density > 0.5) use = rng.chance(0.5) ? 'office' : 'commercial'
        else if (c > 0.55) use = 'mixed'
        else if (density < 0.35 && rng.chance(0.3)) use = 'industrial'
        else if (rng.chance(0.06)) use = 'civic'
        else use = 'residential'
      }
      blocks.push({ x0, y0, x1, y1, use, density })
    }
  }
  return blocks
}

export function blockRing(b: Block, inset: number): number[] {
  return [b.x0 + inset, b.y0 + inset, b.x1 - inset, b.y0 + inset, b.x1 - inset, b.y1 - inset, b.x0 + inset, b.y1 - inset]
}

export function toRenderBlocks(blocks: Block[], unitPerMetre: number): RenderBlock[] {
  const inset = (ROAD_WIDTH.local / 2) * unitPerMetre
  return blocks.map((b) => ({ ring: blockRing(b, inset), density: b.density, use: b.use }))
}

/** Floors by land use, scaled by density. */
function floorsFor(use: LandUse, density: number, rng: PRNG): number {
  const base: Record<LandUse, [number, number]> = {
    residential: [2, 5], commercial: [2, 8], office: [5, 18], industrial: [1, 3], civic: [2, 5], mixed: [3, 9],
  }
  const [lo, hi] = base[use]
  const f = lo + (hi - lo) * Math.min(1, density * 1.3) * rng.range(0.6, 1.2)
  return Math.max(1, Math.round(f))
}

/**
 * Building grammar: subdivide a block into lots along its long axis, with a
 * street setback, then place a footprint per lot. Occasionally lots merge
 * into one larger footprint (a tower or a mall), and occasionally a lot is
 * left as a courtyard.
 */
export function generateBuildings(block: Block, blockIndex: number, chunkKey: string, rng: PRNG, unitPerMetre: number): RenderBuilding[] {
  if (block.use === 'park' || block.use === 'construction' || block.use === 'transit') return []
  const use = block.use
  const setback = (ROAD_WIDTH.collector / 2 + 4) * unitPerMetre
  const x0 = block.x0 + setback, y0 = block.y0 + setback, x1 = block.x1 - setback, y1 = block.y1 - setback
  const w = x1 - x0, h = y1 - y0
  if (w <= 8 * unitPerMetre || h <= 8 * unitPerMetre) return []

  const lotWidth = (use === 'office' || use === 'industrial' ? rng.range(28, 48) : use === 'commercial' ? rng.range(18, 34) : rng.range(12, 24)) * unitPerMetre
  const horizontalLots = w >= h
  const long = horizontalLots ? w : h
  const short = horizontalLots ? h : w
  const nLots = Math.max(1, Math.floor(long / lotWidth))
  const lotLen = long / nLots
  const rows = short > 2.4 * lotWidth ? 2 : 1
  const rowDepth = short / rows

  const out: RenderBuilding[] = []
  let k = 0
  for (let r = 0; r < rows; r++) {
    let i = 0
    while (i < nLots) {
      const merge = rng.chance(0.12) && i < nLots - 1 ? 2 : 1
      if (rng.chance(0.07)) { i += merge; continue } // courtyard / vacant lot
      const gap = rng.range(1.5, 3.5) * unitPerMetre
      const a0 = i * lotLen + gap
      const a1 = (i + merge) * lotLen - gap
      const b0 = r * rowDepth + gap
      const depth = Math.min(rowDepth - 2 * gap, rng.range(0.55, 0.95) * rowDepth)
      const b1 = b0 + depth
      const rx0 = horizontalLots ? x0 + a0 : x0 + b0
      const rx1 = horizontalLots ? x0 + a1 : x0 + b1
      const ry0 = horizontalLots ? y0 + b0 : y0 + a0
      const ry1 = horizontalLots ? y0 + b1 : y0 + a1
      if (rx1 - rx0 > 4 * unitPerMetre && ry1 - ry0 > 4 * unitPerMetre) {
        let floors = floorsFor(use, block.density, rng)
        if (merge === 2 && use !== 'residential') floors = Math.round(floors * 1.6)
        out.push({ id: `b:${chunkKey}:${blockIndex}:${k++}`, ring: [rx0, ry0, rx1, ry0, rx1, ry1, rx0, ry1], floors, landUse: use })
      }
      i += merge
    }
  }
  return out
}

export function generatePark(block: Block, blockIndex: number, chunkKey: string, unitPerMetre: number): RenderPark {
  const inset = (ROAD_WIDTH.collector / 2 + 2) * unitPerMetre
  return { id: `p:${chunkKey}:${blockIndex}`, ring: blockRing(block, inset) }
}

export function generateConstructionZone(block: Block, blockIndex: number, chunkKey: string, unitPerMetre: number): RenderPark {
  const inset = (ROAD_WIDTH.collector / 2 + 2) * unitPerMetre
  return { id: `c:${chunkKey}:${blockIndex}`, ring: blockRing(block, inset) }
}

export function generateTransitStop(block: Block, blockIndex: number, chunkKey: string, rng: PRNG): RenderPoint {
  return { id: `t:${chunkKey}:${blockIndex}`, x: (block.x0 + block.x1) / 2, y: (block.y0 + block.y1) / 2, label: `${rng.choice(['Metro', 'Metro', 'Bus'])} station` }
}
