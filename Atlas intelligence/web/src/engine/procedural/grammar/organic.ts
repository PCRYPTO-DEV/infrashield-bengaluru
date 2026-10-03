import { PRNG } from '../../seed/prng'
import { hashMix } from '../../seed/hash'
import { Noise } from '../noise'
import type { TileId } from '../../../geo/tiles/tiles'
import type { RoadClass } from '../../../entities/types'
import type { GraphEdge, GraphNode, RenderRoad } from '../../world/chunkTypes'
import { ROAD_WIDTH, ROAD_SPEED, ROAD_LANES, presentLines, edgeLineClass, edgeLineName, nodeId, type RoadBuildContext } from './roads'
import { segmentsIntersect } from '../../../geo/geometry'

/**
 * Organic street grammar.
 *
 * Streets are noise-warped lines rather than straight grid lines: a
 * "vertical" street at base x follows x + A·fbm(y) and bends gently; a
 * "horizontal" street bends in y. Everything is a function of absolute
 * coordinates and the global seed, so a neighbouring tile computes the
 * very same curve for a shared street and both tiles meet at identical
 * intersection points. Every vertex becomes a graph node, so simulated
 * traffic follows the curves instead of cutting corners.
 */

export interface WarpedLine {
  id: string
  axis: 'v' | 'h'
  base: number
  roadClass: RoadClass
  name: string
  owned: boolean
  /** owned: this tile draws it; boundary: the neighbour owns it but it bounds our blocks; neighbour: only for crossing computation */
  role: 'owned' | 'boundary' | 'neighbour'
  pts: Array<{ x: number; y: number }>
}

const STATION_M = 24
const noiseCache = new Map<string, Noise>()
function warpNoise(globalSeed: string): Noise {
  let n = noiseCache.get(globalSeed)
  if (!n) { n = new Noise(hashMix(globalSeed, 'warp')); noiseCache.set(globalSeed, n) }
  return n
}

/** Lateral displacement of a street at an absolute position along it. */
export function warpOffset(noise: Noise, axis: 'v' | 'h', base: number, along: number, roadClass: RoadClass, unitPerMetre: number): number {
  const amp = (roadClass === 'arterial' ? 9 : roadClass === 'collector' ? 16 : 24) * unitPerMetre
  const f1 = 1 / (380 * unitPerMetre), f2 = 1 / (120 * unitPerMetre)
  const k = axis === 'v' ? 11.3 : 57.1
  const a = noise.noise3(along * f1, base * 0.00137 + k, 0.5)
  const b = noise.noise3(along * f2 + 3.7, base * 0.00091 + k, 2.5)
  return amp * (0.75 * a + 0.25 * b)
}

/** Sample a warped line between absolute stations [from, to] at a fixed world cadence. */
export function sampleWarpedLine(noise: Noise, axis: 'v' | 'h', base: number, from: number, to: number, roadClass: RoadClass, unitPerMetre: number): Array<{ x: number; y: number }> {
  // Vertices sit on absolute multiples of the station step, never on tile-dependent endpoints,
  // so two tiles sampling the same street produce bit-identical vertices where they overlap.
  const step = STATION_M * unitPerMetre
  const i0 = Math.floor(from / step), i1 = Math.ceil(to / step)
  const pts: Array<{ x: number; y: number }> = []
  for (let i = i0; i <= i1; i++) {
    const s = i * step
    const o = warpOffset(noise, axis, base, s, roadClass, unitPerMetre)
    pts.push(axis === 'v' ? { x: base + o, y: s } : { x: s, y: base + o })
  }
  return pts
}

/** Build all warped lines a tile needs: owned west/north edges and interior lines, plus the east/south boundaries it must terminate on. */
export function tileLines(ctx: RoadBuildContext): WarpedLine[] {
  const { globalSeed, tile, minX, minY, size, unitPerMetre } = ctx
  const maxX = minX + size, maxY = minY + size
  const noise = warpNoise(globalSeed)
  const key = `${tile.z}/${tile.x}/${tile.y}`
  const lines: WarpedLine[] = []
  // vertical lines (base x): west edge (owned), interior (owned), east edge (neighbour's, for termination)
  const pad = 3 * STATION_M * unitPerMetre
  const vLine = (base: number, cls: RoadClass, name: string, id: string, role: WarpedLine['role']) => lines.push({ id, axis: 'v', base, roadClass: cls, name, owned: role === 'owned', role, pts: sampleWarpedLine(noise, 'v', base, minY - pad, maxY + pad, cls, unitPerMetre) })
  const hLine = (base: number, cls: RoadClass, name: string, id: string, role: WarpedLine['role']) => lines.push({ id, axis: 'h', base, roadClass: cls, name, owned: role === 'owned', role, pts: sampleWarpedLine(noise, 'h', base, minX - pad, maxX + pad, cls, unitPerMetre) })
  vLine(minX, edgeLineClass(globalSeed, 'col', tile.x), edgeLineName(globalSeed, 'col', tile.x), `r:${key}:w`, 'owned')
  vLine(maxX, edgeLineClass(globalSeed, 'col', tile.x + 1), edgeLineName(globalSeed, 'col', tile.x + 1), `r:${tile.z}/${tile.x + 1}/${tile.y}:w`, 'boundary')
  presentLines(globalSeed, tile, 'col').forEach((l, i) => vLine(minX + l.frac * size, l.roadClass, l.name, `r:${key}:v${i}`, 'owned'))
  hLine(minY, edgeLineClass(globalSeed, 'row', tile.y), edgeLineName(globalSeed, 'row', tile.y), `r:${key}:n`, 'owned')
  hLine(maxY, edgeLineClass(globalSeed, 'row', tile.y + 1), edgeLineName(globalSeed, 'row', tile.y + 1), `r:${tile.z}/${tile.x}/${tile.y + 1}:n`, 'boundary')
  presentLines(globalSeed, tile, 'row').forEach((l, i) => hLine(minY + l.frac * size, l.roadClass, l.name, `r:${key}:h${i}`, 'owned'))
  // Neighbours' interior streets cross our owned edge streets; include them so the crossing nodes match theirs.
  presentLines(globalSeed, { ...tile, x: tile.x - 1 }, 'row').forEach((l, i) => hLine(minY + l.frac * size, l.roadClass, l.name, `r:${tile.z}/${tile.x - 1}/${tile.y}:h${i}`, 'neighbour'))
  presentLines(globalSeed, { ...tile, y: tile.y - 1 }, 'col').forEach((l, i) => vLine(minX + l.frac * size, l.roadClass, l.name, `r:${tile.z}/${tile.x}/${tile.y - 1}:v${i}`, 'neighbour'))
  return lines
}

export interface Crossing { x: number; y: number; vi: number; hi: number; vSeg: number; hSeg: number; vt: number; ht: number }

/** Intersections of every vertical line with every horizontal line (argument order fixed for bit-identical results across tiles). */
export function crossings(lines: WarpedLine[]): Crossing[] {
  const out: Crossing[] = []
  lines.forEach((v, vi) => {
    if (v.axis !== 'v') return
    lines.forEach((h, hi) => {
      if (h.axis !== 'h') return
      for (let i = 0; i < v.pts.length - 1; i++) {
        const a = v.pts[i], b = v.pts[i + 1]
        for (let j = 0; j < h.pts.length - 1; j++) {
          const c = h.pts[j], d = h.pts[j + 1]
          if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.min(a.y, b.y) > Math.max(c.y, d.y) || Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.min(a.x, b.x) > Math.max(c.x, d.x)) continue
          if (!segmentsIntersect(a, b, c, d)) continue
          const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
          if (den === 0) continue
          const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den
          const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den
          out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), vi, hi, vSeg: i, hSeg: j, vt: t, ht: u })
        }
      }
    })
  })
  return out
}

/** The polyline of a line with crossing points inserted as vertices, in order. */
function withCrossings(line: WarpedLine, index: number, cross: Crossing[]): Array<{ x: number; y: number; crossing: boolean }> {
  const mine = cross.filter((c) => (line.axis === 'v' ? c.vi === index : c.hi === index))
  const out: Array<{ x: number; y: number; crossing: boolean }> = []
  for (let i = 0; i < line.pts.length; i++) {
    out.push({ ...line.pts[i], crossing: false })
    const here = mine.filter((c) => (line.axis === 'v' ? c.vSeg === i : c.hSeg === i)).sort((p, q) => (line.axis === 'v' ? p.vt - q.vt : p.ht - q.ht))
    for (const c of here) out.push({ x: c.x, y: c.y, crossing: true })
  }
  return out
}

export interface OrganicLayout {
  lines: WarpedLine[]
  cross: Crossing[]
  /** block polygons (local coords) between consecutive lines, with the lines' indices */
  blocks: Array<{ ring: Array<{ x: number; y: number }>; cx: number; cy: number; area: number }>
}

/** Build the owned roads of a tile as warped polylines and per-vertex graph edges. */
export function generateOrganicNetwork(ctx: RoadBuildContext): OrganicLayout {
  const lines = tileLines(ctx)
  const cross = crossings(lines)
  const { minX, minY, size } = ctx
  const maxX = minX + size, maxY = minY + size
  const speedOf = (c: RoadClass) => ROAD_SPEED[c] * ctx.unitPerMetre
  const addNode = (p: { x: number; y: number }): GraphNode => {
    const id = nodeId(p.x, p.y)
    let n = ctx.nodes.get(id)
    if (!n) { n = { id, x: p.x, y: p.y, signal: false }; ctx.nodes.set(id, n) }
    return n
  }
  lines.forEach((line, li) => {
    if (!line.owned) return
    const verts = withCrossings(line, li, cross)
    // keep only the portion inside the tile's extent along the line (between the boundary crossings)
    const along = (p: { x: number; y: number }) => (line.axis === 'v' ? p.y : p.x)
    const lo = line.axis === 'v' ? minY : minX, hi = line.axis === 'v' ? maxY : maxX
    const tol = 40 * ctx.unitPerMetre
    const first = verts.findIndex((v) => v.crossing && Math.abs(along(v) - lo) < tol)
    const lastRev = [...verts].reverse().findIndex((v) => v.crossing && Math.abs(along(v) - hi) < tol)
    const last = lastRev === -1 ? -1 : verts.length - 1 - lastRev
    const span = first >= 0 && last > first ? verts.slice(first, last + 1) : verts.filter((v) => along(v) >= lo - 1e-6 && along(v) <= hi + 1e-6)
    if (span.length < 2) return
    const pts: number[] = []
    for (const v of span) pts.push(v.x, v.y)
    ctx.roads.push({ id: line.id, roadClass: line.roadClass, pts, width: ROAD_WIDTH[line.roadClass] * ctx.unitPerMetre, name: line.name } as RenderRoad)
    for (let i = 0; i < span.length - 1; i++) {
      const a = addNode(span[i]), b = addNode(span[i + 1])
      if (a.id === b.id) continue
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const base = { roadId: line.id, roadClass: line.roadClass, lanes: ROAD_LANES[line.roadClass], oneway: false, speedLimit: speedOf(line.roadClass), length, axis: (line.axis === 'v' ? 'ns' : 'ew') as 'ns' | 'ew' }
      ctx.edges.push({ id: `${a.id}>${b.id}`, from: a.id, to: b.id, ...base } as GraphEdge, { id: `${b.id}>${a.id}`, from: b.id, to: a.id, ...base } as GraphEdge)
    }
  })

  // ---- blocks: cells between consecutive verticals and horizontals, bounded by the warped lines ----
  const vIdx = lines.map((l, i) => ({ l, i })).filter((e) => e.l.axis === 'v' && e.l.role !== 'neighbour').sort((p, q) => p.l.base - q.l.base)
  const hIdx = lines.map((l, i) => ({ l, i })).filter((e) => e.l.axis === 'h' && e.l.role !== 'neighbour').sort((p, q) => p.l.base - q.l.base)
  const find = (vi: number, hi: number) => cross.find((c) => c.vi === vi && c.hi === hi)
  const portion = (line: WarpedLine, li: number, from: Crossing, to: Crossing) => {
    const verts = withCrossings(line, li, cross)
    const ia = verts.findIndex((v) => v.crossing && Math.abs(v.x - from.x) < 1e-6 && Math.abs(v.y - from.y) < 1e-6)
    const ib = verts.findIndex((v) => v.crossing && Math.abs(v.x - to.x) < 1e-6 && Math.abs(v.y - to.y) < 1e-6)
    if (ia < 0 || ib < 0) return [from, to].map((p) => ({ x: p.x, y: p.y }))
    const seg = ia <= ib ? verts.slice(ia, ib + 1) : verts.slice(ib, ia + 1).reverse()
    return seg.map((p) => ({ x: p.x, y: p.y }))
  }
  const blocks: OrganicLayout['blocks'] = []
  for (let i = 0; i < vIdx.length - 1; i++) {
    for (let j = 0; j < hIdx.length - 1; j++) {
      const v0 = vIdx[i], v1 = vIdx[i + 1], h0 = hIdx[j], h1 = hIdx[j + 1]
      const c00 = find(v0.i, h0.i), c01 = find(v0.i, h1.i), c11 = find(v1.i, h1.i), c10 = find(v1.i, h0.i)
      if (!c00 || !c01 || !c11 || !c10) continue
      const ring = [...portion(v0.l, v0.i, c00, c01), ...portion(h1.l, h1.i, c01, c11).slice(1), ...portion(v1.l, v1.i, c11, c10).slice(1), ...portion(h0.l, h0.i, c10, c00).slice(1, -1)]
      if (ring.length < 3) continue
      let a = 0, cx = 0, cy = 0
      for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) { const f = ring[m].x * ring[k].y - ring[k].x * ring[m].y; a += f; cx += (ring[m].x + ring[k].x) * f; cy += (ring[m].y + ring[k].y) * f }
      a /= 2
      if (Math.abs(a) < 1e-6) continue
      blocks.push({ ring, cx: cx / (6 * a), cy: cy / (6 * a), area: Math.abs(a) })
    }
  }
  return { lines, cross, blocks }
}

/** Shrink a ring toward its centroid by `d` (approximate inset, fine for drawing). */
export function insetRing(ring: Array<{ x: number; y: number }>, cx: number, cy: number, d: number): Array<{ x: number; y: number }> {
  return ring.map((p) => { const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; const k = Math.max(0, 1 - d / l); return { x: cx + dx * k, y: cy + dy * k } })
}

export function tileSeedRng(globalSeed: string, tile: TileId, stream: string): PRNG {
  return new PRNG(hashMix(globalSeed, stream, tile.x, tile.y))
}
