import type { PRNG } from '../../seed/prng'
import type { Noise } from '../noise'
import type { LandUse } from '../../../entities/types'
import type { RenderBuilding, RenderPark, RenderPoint, RenderBlock } from '../../world/chunkTypes'
import { ROAD_WIDTH } from './roads'
import { insetRing } from './organic'
import { pointInPolygon } from '../../../geo/geometry'

export type BlockUse = LandUse | 'park' | 'construction' | 'transit'

export interface Block {
  /** polygon ring in local coordinates (any shape) */
  ring: Array<{ x: number; y: number }>
  cx: number
  cy: number
  area: number
  /** axis-aligned bounds, kept for cheap tests */
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

/** Decide what each block polygon becomes. */
export function planBlocks(cells: Array<{ ring: Array<{ x: number; y: number }>; cx: number; cy: number; area: number }>, fields: CityFields, rng: PRNG, unitPerMetre: number): Block[] {
  const blocks: Block[] = []
  const minArea = 40 * 40 * unitPerMetre * unitPerMetre
  for (const c of cells) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of c.ring) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
    const density = fields.density(c.cx, c.cy)
    let use: BlockUse
    if (c.area < minArea) use = 'park'
    else if (fields.green(c.cx, c.cy) > 0.66 && rng.chance(0.7)) use = 'park'
    else if (rng.chance(0.035)) use = 'construction'
    else if (density > 0.55 && rng.chance(0.05)) use = 'transit'
    else {
      const k = fields.commercial(c.cx, c.cy)
      if (k > 0.62 && density > 0.5) use = rng.chance(0.5) ? 'office' : 'commercial'
      else if (k > 0.55) use = 'mixed'
      else if (density < 0.35 && rng.chance(0.3)) use = 'industrial'
      else if (rng.chance(0.06)) use = 'civic'
      else use = 'residential'
    }
    blocks.push({ ring: c.ring, cx: c.cx, cy: c.cy, area: c.area, x0, y0, x1, y1, use, density })
  }
  return blocks
}

function flatRing(ring: Array<{ x: number; y: number }>): number[] { const o: number[] = []; for (const p of ring) o.push(p.x, p.y); return o }

export function blockRing(b: Block, inset: number): number[] {
  return flatRing(insetRing(b.ring, b.cx, b.cy, inset))
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
 * Building grammar: lots are laid along each street edge of the block
 * polygon, so buildings hug curved streets. Each lot is a rectangle
 * aligned with its street, set back from the kerb; a lot is kept only if
 * it lies inside the block and does not overlap an earlier one. Large
 * blocks get a second, deeper row.
 */
export function generateBuildings(block: Block, blockIndex: number, chunkKey: string, rng: PRNG, unitPerMetre: number): RenderBuilding[] {
  if (block.use === 'park' || block.use === 'construction' || block.use === 'transit') return []
  const use = block.use
  const setback = (ROAD_WIDTH.collector / 2 + 3) * unitPerMetre
  const lotWidth = (use === 'office' || use === 'industrial' ? rng.range(26, 44) : use === 'commercial' ? rng.range(16, 30) : rng.range(11, 20)) * unitPerMetre
  const depthM = (use === 'office' ? rng.range(18, 30) : use === 'industrial' ? rng.range(24, 40) : rng.range(10, 18))
  const ring = block.ring
  const out: RenderBuilding[] = []
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  let k = 0
  const inside = (p: { x: number; y: number }) => pointInPolygon(p, ring)
  const tryPlace = (cx: number, cy: number, ux: number, uy: number, half: number, depth: number, floors: number) => {
    // rectangle centred at (cx,cy), long axis along (ux,uy), inward normal (nx,ny)
    const nx = -uy, ny = ux
    const corners = [
      { x: cx - ux * half - nx * depth / 2, y: cy - uy * half - ny * depth / 2 },
      { x: cx + ux * half - nx * depth / 2, y: cy + uy * half - ny * depth / 2 },
      { x: cx + ux * half + nx * depth / 2, y: cy + uy * half + ny * depth / 2 },
      { x: cx - ux * half + nx * depth / 2, y: cy - uy * half + ny * depth / 2 },
    ]
    if (!corners.every(inside)) return false
    const bx0 = Math.min(...corners.map((c) => c.x)), bx1 = Math.max(...corners.map((c) => c.x)), by0 = Math.min(...corners.map((c) => c.y)), by1 = Math.max(...corners.map((c) => c.y))
    for (const q of placed) if (bx0 < q.x1 && bx1 > q.x0 && by0 < q.y1 && by1 > q.y0) return false
    placed.push({ x0: bx0, y0: by0, x1: bx1, y1: by1 })
    out.push({ id: `b:${chunkKey}:${blockIndex}:${k++}`, ring: corners.flatMap((c) => [c.x, c.y]), floors, landUse: use })
    return true
  }
  for (let rowIdx = 0; rowIdx < 2; rowIdx++) {
    const rowOffset = setback + rowIdx * (depthM * unitPerMetre + 6 * unitPerMetre)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey)
      if (len < lotWidth * 0.8) continue
      const ux = ex / len, uy = ey / len
      // inward normal: polygon orientation varies, so test which side the centroid is on
      let nx = -uy, ny = ux
      if ((block.cx - a.x) * nx + (block.cy - a.y) * ny < 0) { nx = -nx; ny = -ny }
      const n = Math.max(1, Math.floor(len / lotWidth))
      const lotLen = len / n
      for (let j = 0; j < n; j++) {
        if (rng.chance(0.08)) continue // vacant lot / courtyard
        const merge = rng.chance(0.1) && j < n - 1 ? 2 : 1
        const gap = rng.range(1.5, 3) * unitPerMetre
        const depth = depthM * rng.range(0.7, 1.0) * unitPerMetre
        const half = (merge * lotLen) / 2 - gap
        const cx = a.x + ux * ((j + merge / 2) * lotLen) + nx * (rowOffset + depth / 2)
        const cy = a.y + uy * ((j + merge / 2) * lotLen) + ny * (rowOffset + depth / 2)
        let floors = floorsFor(use, block.density, rng)
        if (merge === 2 && use !== 'residential') floors = Math.round(floors * 1.6)
        // tryPlace expects the inward normal to be (-uy, ux); flip u if we flipped n
        const flip = nx !== -uy || ny !== ux
        tryPlace(cx, cy, flip ? -ux : ux, flip ? -uy : uy, half, depth, floors)
        if (merge === 2) j++
      }
    }
    if (block.area < 140 * 140 * unitPerMetre * unitPerMetre) break
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
  return { id: `t:${chunkKey}:${blockIndex}`, x: block.cx, y: block.cy, label: `${rng.choice(['Metro', 'Metro', 'Bus'])} station` }
}
