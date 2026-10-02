import type { RenderChunk, RenderBuilding } from '../../engine/world/chunkTypes'
import { Scene, Prism, Vector, Matrix, Paths, type Path } from '../ln'
import { inkPaths, type Pt } from './ink'
import { PRNG } from '../../engine/seed/prng'
import { PALETTE } from '../palette'
import { roadLabels, parkLabels, greenFill } from './chunkSvg'

/**
 * The Ink 3D tier: fogleman/ln's hidden-line renderer drawing the chunk as
 * a 3D line scene, finished with Shan Shui ink strokes.
 *
 * Projection is *oblique and parallel* (x' = x + KX·z, y' = y − KY·z), in
 * world units, so a building in one tile lines up with the road in the
 * next: no per-tile camera, no seams. The ground plane is untouched, which
 * is what lets the moving dots (drawn on the canvas) stay in place.
 */
export const INK_KX = 0.32
export const INK_KY = 0.78
/** From the scene towards the viewer: the direction every visibility ray travels. */
export const INK_TOWARD = new Vector(-INK_KX, INK_KY, 1)
export const FLOOR_M = 3.2

export function inkMatrix(): Matrix { return new Matrix([1, 0, INK_KX, 0, 0, 1, -INK_KY, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }

/** Where a point at height z (world units) lands on the 2D map. */
export function inkProject(x: number, y: number, z: number): Pt { return { x: x + INK_KX * z, y: y - INK_KY * z } }


function ringPts(ring: number[]): Pt[] { const out: Pt[] = []; for (let i = 0; i < ring.length; i += 2) out.push({ x: ring[i], y: ring[i + 1] }); return out }

function signedArea(p: Pt[]): number { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i].x * p[j].y - p[j].x * p[i].y } return a / 2 }

export function buildingHeight(b: RenderBuilding, upm: number): number { return Math.max(1, b.floors) * FLOOR_M * upm }

/** Hatch lines on the walls that face the viewer (south and west faces). */
function wallHatch(p: Pt[], z1: number, upm: number): Path[] {
  const out: Path[] = []
  const ccw = signedArea(p) > 0 // in screen space (y down) positive area = clockwise visually; we only need consistency
  const spacing = 4.2 * upm
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    const ex = b.x - a.x, ey = b.y - a.y
    const len = Math.hypot(ex, ey)
    if (len < 2 * upm) continue
    // outward normal of this edge
    let nx = ey / len, ny = -ex / len
    if (ccw) { nx = -nx; ny = -ny }
    const facing = nx * -INK_KX + ny * INK_KY
    if (facing <= 0.15) continue
    const count = Math.floor(len / spacing)
    for (let k = 1; k <= count; k++) {
      const t = k / (count + 1)
      const x = a.x + ex * t, y = a.y + ey * t
      out.push([new Vector(x, y, 0), new Vector(x, y, z1 * (0.35 + 0.65 * facing))])
    }
  }
  return out
}

export interface InkOptions {
  /** chop step for visibility sampling, world units */
  step?: number
  /** draw wall hatching */
  hatch?: boolean
}

/**
 * Builds the `<g>` for one chunk. Buildings are prisms; roads and park
 * outlines are ground paths. Everything goes through ln's hidden-line
 * filter, then each surviving path becomes an ink stroke.
 */
export function buildInkSvg(key: string, chunk: RenderChunk, upm: number, opts: InkOptions = {}): string {
  const step = opts.step ?? 8 * upm
  // Only solids go into the scene: they are what hides lines.
  const scene = new Scene()
  const prisms: Array<{ b: RenderBuilding; pts: Pt[]; z1: number }> = []
  for (const b of chunk.buildings) {
    const pts = ringPts(b.ring)
    if (pts.length < 3) continue
    const z1 = buildingHeight(b, upm)
    scene.add(new Prism(pts, 0, z1))
    prisms.push({ b, pts, z1 })
  }
  const roads: Vector[][] = []
  for (const r of chunk.roads) {
    const v: Vector[] = []
    for (let i = 0; i < r.pts.length; i += 2) v.push(new Vector(r.pts[i], r.pts[i + 1], 0))
    if (v.length > 1) roads.push(v)
  }
  const parks: Vector[][] = []
  for (const p of chunk.parks) {
    const v = ringPts(p.ring).map((q) => new Vector(q.x, q.y, 0))
    if (v.length > 2) { v.push(v[0]); parks.push(v) }
  }
  const edges: Path[] = [], hatch: Path[] = []
  for (const p of prisms) {
    edges.push(...new Prism(p.pts, 0, p.z1).paths().items)
    if (opts.hatch !== false && p.b.floors >= 3) hatch.push(...wallHatch(p.pts, p.z1, upm))
  }

  const visible = (lines: Path[]) => Paths.from(lines).chop(step).filter(parallelFilter(scene)).simplify(1e-6).items
  const toPts = (p: Path): Pt[] => p.map((v) => ({ x: v.x, y: v.y }))
  const strokes = (lines: Path[], width: number, noise: number) => visible(lines).map((p) => ({ pts: toPts(p), style: { width, noise } }))

  const rng = new PRNG(0x1a4 ^ key.length)
  const parts: string[] = []
  // Greenery first, under everything: every mapped green area as a soft ground; trees only where OSM has one.
  for (const p of chunk.parks) parts.push(greenGround(ringPts(p.ring), p.kind))
  const roadStrokes = strokes(roads, 1.6 * upm, 0.35)
  if (roadStrokes.length) parts.push(inkPaths(roadStrokes, PALETTE.roadCasing, rng.fork('roads'), 8 * upm))
  const parkStrokes = strokes(parks, 0.8 * upm, 0.6)
  if (parkStrokes.length) parts.push(inkPaths(parkStrokes, PALETTE.parkStipple, rng.fork('parks'), 8 * upm))
  const hatchStrokes = strokes(hatch, 0.45 * upm, 0.5)
  if (hatchStrokes.length) parts.push(inkPaths(hatchStrokes, PALETTE.inkFaint, rng.fork('hatch'), 10 * upm))
  const edgeStrokes = strokes(edges, 0.95 * upm, 0.45)
  if (edgeStrokes.length) parts.push(inkPaths(edgeStrokes, PALETTE.ink, rng.fork('edges'), 7 * upm))

  // Street names on the ground plane, the same labels as the 2D map, so they line up across modes.
  parts.push(roadLabels(chunk))
  parts.push(parkLabels(chunk))
  for (const t of chunk.trees ?? []) parts.push(tree3d(t.x, t.y, upm))
  // Transit marks stay flat on the ground so they match the 2D map.
  for (const t of chunk.transit) parts.push(`<rect x="${(t.x - 7).toFixed(1)}" y="${(t.y - 7).toFixed(1)}" width="14" height="14" fill="none" stroke="${PALETTE.transit}" stroke-width="1.2"/>`)
  return `<g data-chunk="${key}" data-lod="ink">${parts.join('')}</g>`
}

/** A park in ink: its real outline as a soft green ground. No texture is invented for it. */
function greenGround(ring: Pt[], kind?: string): string {
  if (ring.length < 3) return ''
  const d = ring.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('') + 'Z'
  return `<path d="${d}" fill="${greenFill(kind)}" stroke="none"/>`
}

/** One mapped tree in 3D: a trunk of about 4 m and a canopy at its top, in the same oblique projection as the buildings. */
function tree3d(x: number, y: number, upm: number): string {
  const top = inkProject(x, y, 4 * upm)
  const r = 2.8 * upm
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${top.x.toFixed(1)} ${top.y.toFixed(1)}" stroke="${PALETTE.foliageInk}" stroke-width="${(0.7 * upm).toFixed(2)}" fill="none"/>` +
    `<circle class="ca-tree" cx="${top.x.toFixed(1)}" cy="${top.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${PALETTE.foliage}" stroke="${PALETTE.foliageInk}" stroke-width="${(0.5 * upm).toFixed(2)}"/>` +
    `<circle cx="${(top.x - r * 0.45).toFixed(1)}" cy="${(top.y + r * 0.2).toFixed(1)}" r="${(r * 0.65).toFixed(1)}" fill="${PALETTE.foliage}" stroke="${PALETTE.foliageInk}" stroke-width="${(0.4 * upm).toFixed(2)}"/>`
}

function parallelFilter(scene: Scene) {
  scene.compile()
  const m = inkMatrix()
  return { filter(v: Vector): [Vector, boolean] { return [m.mulPositionW(v), scene.visibleAlong(v, INK_TOWARD)] } }
}


/**
 * A standalone SVG document of one or more ink chunks: what "Save line
 * drawing" exports. Pen-plotter friendly: strokes only, paper white.
 */
export function inkDocument(groups: string[], bounds: { minX: number; minY: number; maxX: number; maxY: number }, title: string): string {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX.toFixed(1)} ${bounds.minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" width="${Math.round(w)}" height="${Math.round(h)}"><title>${title.replace(/[<&]/g, '')}</title><rect x="${bounds.minX.toFixed(1)}" y="${bounds.minY.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE.paper}"/>${groups.join('')}</svg>`
}
