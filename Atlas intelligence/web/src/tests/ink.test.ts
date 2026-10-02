import { describe, it, expect } from 'vitest'
import { strokeOutline, strokePath, resample, inkPaths } from '../rendering/svg/ink'
import { buildInkSvg, inkProject, inkDocument, INK_KX, INK_KY, buildingHeight } from '../rendering/svg/inkSvg'
import { PRNG } from '../engine/seed/prng'
import type { RenderChunk, RenderBuilding } from '../engine/world/chunkTypes'

const box = (id: string, x: number, y: number, w: number, h: number, floors: number): RenderBuilding => ({ id, ring: [x, y, x + w, y, x + w, y + h, x, y + h], floors, landUse: 'residential' })
const empty = (): RenderChunk => ({ roads: [], buildings: [], parks: [], signals: [], transit: [], construction: [], blocks: [] })

describe('Shan Shui ink strokes', () => {
  it('turns a line into a closed polygon that swells in the middle', () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }], 5)
    const o = strokeOutline(pts, { width: 4, noise: 0 }, new PRNG(1))
    expect(o.length).toBe(pts.length * 2)
    const mid = o[Math.floor(pts.length / 2)], end = o[0]
    expect(Math.abs(mid.y)).toBeGreaterThan(Math.abs(end.y))
    expect(strokePath(pts, { width: 4 }, new PRNG(1))).toMatch(/^M.*Z$/)
  })
  it('is deterministic for the same seed and differs for another', () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 50, y: 30 }], 4)
    const a = strokePath(pts, { width: 2 }, new PRNG(7)), b = strokePath(pts, { width: 2 }, new PRNG(7)), c = strokePath(pts, { width: 2 }, new PRNG(8))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
  it('merges many strokes into one path element', () => {
    const svg = inkPaths([{ pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }], style: { width: 1 } }, { pts: [{ x: 0, y: 5 }, { x: 10, y: 5 }], style: { width: 1 } }], '#000', new PRNG(1))
    expect(svg.match(/<path/g)?.length).toBe(1)
    expect(svg.match(/Z/g)?.length).toBe(2)
  })
})

describe('Ink 3D tier (fogleman/ln hidden-line on chunk geometry)', () => {
  const upm = 1
  it('projects height up-screen with the oblique matrix', () => {
    const p = inkProject(10, 10, 5)
    expect(p.x).toBeCloseTo(10 + INK_KX * 5); expect(p.y).toBeCloseTo(10 - INK_KY * 5)
    expect(buildingHeight(box('b', 0, 0, 1, 1, 10), 2)).toBeCloseTo(64)
  })
  it('draws a building as ink edges and leaves roads on the ground', () => {
    const chunk = empty()
    chunk.buildings.push(box('a', 20, 20, 20, 20, 3))
    chunk.roads.push({ id: 'r', roadClass: 'arterial', pts: [0, 80, 100, 80], width: 8, name: 'Ring Road' })
    const svg = buildInkSvg('16/1/1', chunk, upm)
    expect(svg).toContain('data-lod="ink"')
    expect(svg.match(/<path/g)?.length).toBeGreaterThanOrEqual(2)
    // the road is a ground stroke: its vertices stay near y = 80
    const ys = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(ys.some((y) => Math.abs(y - 80) < 3)).toBe(true)
    // the roof is above the footprint (smaller y)
    expect(Math.min(...ys)).toBeLessThan(20 - INK_KY * 3 * 3.2 + 1)
  })
  it('hides edges behind a taller building in front of them', () => {
    const alone = empty(); alone.buildings.push(box('small', 60, 10, 10, 10, 2))
    const withTower = empty(); withTower.buildings.push(box('small', 60, 10, 10, 10, 2), box('tower', 30, 30, 30, 30, 30))
    const count = (svg: string) => (svg.match(/Z/g) ?? []).length
    const a = buildInkSvg('16/1/1', alone, upm, { hatch: false })
    const b = buildInkSvg('16/1/1', withTower, upm, { hatch: false })
    // the tower's own edges add strokes, but the small building loses some: compare the small building's share
    const smallAlone = count(a)
    const towerAlone = count(buildInkSvg('16/1/1', (() => { const c = empty(); c.buildings.push(box('tower', 30, 30, 30, 30, 30)); return c })(), upm, { hatch: false }))
    expect(count(b)).toBeLessThan(smallAlone + towerAlone)
  })
  it('is deterministic and the export wraps it in a plottable document', () => {
    const chunk = empty(); chunk.buildings.push(box('a', 5, 5, 10, 10, 4)); chunk.parks.push({ id: 'p', ring: [40, 40, 60, 40, 60, 60, 40, 60] })
    const a = buildInkSvg('16/2/3', chunk, upm), b = buildInkSvg('16/2/3', chunk, upm)
    expect(a).toBe(b)
    const doc = inkDocument([a], { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 'test <&>')
    expect(doc.startsWith('<?xml')).toBe(true)
    expect(doc).toContain('viewBox="0.0 0.0 100.0 100.0"')
    expect(doc).not.toContain('<&>')
  })
})
