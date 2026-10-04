import { PRNG } from '../../engine/seed/prng'

/**
 * Shan Shui-style ink strokes.
 *
 * Shan Shui draws every line as a *filled polygon* whose width swells in
 * the middle and wobbles with noise, so a plotter-clean line reads as a
 * brush stroke. This is a fresh implementation of that idea for Atlas
 * Infinity: the width profile, the noise factor and the polygon assembly
 * are ours; the look is LingDong Huang's.
 *
 * Coordinates are whatever the caller uses (world units here).
 */
export interface StrokeStyle {
  /** peak width of the stroke */
  width: number
  /** 0 = clean constant width, 1 = fully noisy */
  noise?: number
  /** width profile along the stroke, t in [0, 1] → multiplier */
  profile?: (t: number) => number
}

export type Pt = { x: number; y: number }

const brush = (t: number) => 0.55 + 0.45 * Math.sin(Math.PI * t)
const f = (n: number) => (Math.round(n * 10) / 10).toString()

/** Polygon outline (as a point list) of an ink stroke along `pts`. */
export function strokeOutline(pts: Pt[], style: StrokeStyle, rng: PRNG): Pt[] {
  const n = pts.length
  if (n < 2) return []
  const profile = style.profile ?? brush
  const noise = style.noise ?? 0.5
  const left: Pt[] = [], right: Pt[] = []
  // A slow random walk, not white noise, so the edge wanders like a hair line.
  let wobble = 0
  for (let i = 0; i < n; i++) {
    wobble = wobble * 0.6 + (rng.next() - 0.5) * 0.8
    const w = style.width * profile(n === 1 ? 0 : i / (n - 1)) * (1 - noise + noise * (0.75 + wobble))
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x, dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l, ny = dx / l
    const p = pts[i]
    left.push({ x: p.x + nx * w / 2, y: p.y + ny * w / 2 })
    right.push({ x: p.x - nx * w / 2, y: p.y - ny * w / 2 })
  }
  return left.concat(right.reverse())
}

/** SVG path data for one stroke polygon. */
export function strokePath(pts: Pt[], style: StrokeStyle, rng: PRNG): string {
  const o = strokeOutline(pts, style, rng)
  if (o.length < 4) return ''
  let d = ''
  for (let i = 0; i < o.length; i++) d += `${i === 0 ? 'M' : 'L'}${f(o[i].x)} ${f(o[i].y)}`
  return d + 'Z'
}

/** Resample a polyline so the stroke has enough vertices to wobble. */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const l = Math.hypot(b.x - a.x, b.y - a.y)
    const k = Math.max(1, Math.ceil(l / step))
    for (let j = 1; j <= k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k })
  }
  return out
}

/**
 * Many strokes of the same colour merged into one `<path>`: each stroke
 * is its own closed sub-path, so the DOM stays small even for a dense tile.
 */
export function inkPaths(strokes: Array<{ pts: Pt[]; style: StrokeStyle }>, colour: string, rng: PRNG, step = 4): string {
  let d = ''
  for (const s of strokes) d += strokePath(resample(s.pts, step), s.style, rng)
  return d ? `<path d="${d}" fill="${colour}" stroke="none" fill-rule="nonzero"/>` : ''
}
