import type { RenderChunk, RenderBuilding, RenderPark } from '../../engine/world/chunkTypes'
import type { RoadClass } from '../../entities/types'
import { PALETTE } from '../palette'
import { PRNG } from '../../engine/seed/prng'

/**
 * Builds the static SVG representation of a chunk as a string, once, in the
 * generation worker. This is the Shan Shui `chunk.canv` idea: geometry is
 * stringified exactly once and the main thread only swaps `<g>` content.
 *
 * Coordinates are local world units. Three LOD strings are produced so a
 * zoom change never requires regeneration.
 */
export type Lod = 'city' | 'neighbourhood' | 'street'

const f = (n: number) => (Math.round(n * 10) / 10).toString()

function ringPath(ring: number[]): string {
  let d = ''
  for (let i = 0; i < ring.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${f(ring[i])} ${f(ring[i + 1])}`
  return d + 'Z'
}

function polyline(pts: number[]): string {
  let d = ''
  for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${f(pts[i])} ${f(pts[i + 1])}`
  return d
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Green areas by what OSM says they are. */
export function greenFill(kind?: string): string {
  if (kind === 'wood' || kind === 'forest' || kind === 'scrub' || kind === 'orchard') return PALETTE.wood
  if (kind === 'grass' || kind === 'meadow' || kind === 'grassland' || kind === 'pitch' || kind === 'heath' || kind === 'village_green' || kind === 'recreation_ground') return PALETTE.grass
  return PALETTE.park
}

/** One mapped tree as a small canopy mark. */
export function tree2d(x: number, y: number): string {
  return `<circle class="ca-tree" cx="${f(x)}" cy="${f(y)}" r="3.6" fill="${PALETTE.foliage}" stroke="${PALETTE.foliageInk}" stroke-width="0.6"/>`
}

/** Names of the larger green areas, at their centre. */
export function parkLabels(chunk: RenderChunk): string {
  const out: string[] = []
  for (const p of chunk.parks) {
    if (!p.name || !p.kind || p.name === p.kind.replace('_', ' ')) continue
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < p.ring.length; i += 2) { minX = Math.min(minX, p.ring[i]); maxX = Math.max(maxX, p.ring[i]); minY = Math.min(minY, p.ring[i + 1]); maxY = Math.max(maxY, p.ring[i + 1]) }
    if ((maxX - minX) < p.name.length * 5) continue
    out.push(`<text class="ca-park-label" x="${f((minX + maxX) / 2)}" y="${f((minY + maxY) / 2)}" font-size="8" text-anchor="middle" fill="${PALETTE.foliageInk}" stroke="${PALETTE.paper}" stroke-width="2" paint-order="stroke" font-family="'DM Sans', 'Helvetica Neue', Arial, sans-serif" font-style="italic">${escapeXml(p.name)}</text>`)
  }
  return out.join('')
}

/** OSM roads without a name carry their highway class as the name; those get no label. */
const CLASS_NAMES = new Set(['residential', 'service', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'living_street', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'arterial', 'collector', 'local'])

/**
 * Street names: one label per distinct name in the chunk, on that road's
 * longest segment, rotated along it and kept upright, with a paper halo so
 * it reads over buildings. Sizes are world units; the map scales them.
 */
export function roadLabels(chunk: RenderChunk, opts: { halo?: string; fill?: string } = {}): string {
  const best = new Map<string, { len: number; mx: number; my: number; angle: number; roadClass: RoadClass }>()
  for (const r of chunk.roads) {
    if (!r.name || CLASS_NAMES.has(r.name.toLowerCase())) continue
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const x0 = r.pts[i], y0 = r.pts[i + 1], x1 = r.pts[i + 2], y1 = r.pts[i + 3]
      const len = Math.hypot(x1 - x0, y1 - y0)
      const cur = best.get(r.name)
      if (cur && cur.len >= len) continue
      let angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
      if (angle > 90) angle -= 180
      if (angle < -90) angle += 180
      best.set(r.name, { len, mx: (x0 + x1) / 2, my: (y0 + y1) / 2, angle, roadClass: r.roadClass })
    }
  }
  const out: string[] = []
  for (const [name, l] of best) {
    const size = l.roadClass === 'arterial' ? 11 : l.roadClass === 'collector' ? 9 : 7.5
    // A label longer than its segment would float over nothing: skip it.
    if (name.length * size * 0.62 > l.len * 1.6) continue
    out.push(`<text class="ca-road-label" x="${f(l.mx)}" y="${f(l.my - 2)}" transform="rotate(${l.angle.toFixed(1)} ${f(l.mx)} ${f(l.my)})" font-size="${size}" text-anchor="middle" fill="${opts.fill ?? PALETTE.ink}" stroke="${opts.halo ?? PALETTE.paper}" stroke-width="${(size * 0.28).toFixed(1)}" paint-order="stroke" stroke-linejoin="round" font-family="'DM Sans', 'Helvetica Neue', Arial, sans-serif" font-weight="600" letter-spacing="0.4">${escapeXml(name)}</text>`)
  }
  return out.join('')
}

/** Stipple texture for parks: a nod to Shan Shui's noisy dot textures, seeded so it is stable. */
function stipple(park: RenderPark, rng: PRNG): string {
  const r = park.ring
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < r.length; i += 2) { minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minY = Math.min(minY, r[i + 1]); maxY = Math.max(maxY, r[i + 1]) }
  const area = (maxX - minX) * (maxY - minY)
  const n = Math.min(160, Math.floor(area / 320))
  let d = ''
  for (let i = 0; i < n; i++) {
    const x = rng.range(minX + 3, maxX - 3)
    const y = rng.range(minY + 3, maxY - 3)
    const len = rng.range(1.2, 2.6)
    d += `M${f(x)} ${f(y)}l${f(len * 0.4)} ${f(-len)}`
  }
  return `<path d="${d}" stroke="${PALETTE.parkStipple}" stroke-width="0.7" fill="none"/>`
}

/** Hatch shading on the south-east faces of buildings, giving mass without colour. */
function hatch(b: RenderBuilding): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < b.ring.length; i += 2) { x0 = Math.min(x0, b.ring[i]); x1 = Math.max(x1, b.ring[i]); y0 = Math.min(y0, b.ring[i + 1]); y1 = Math.max(y1, b.ring[i + 1]) }
  const w = x1 - x0, h = y1 - y0
  const spacing = Math.max(2.2, 6 - b.floors * 0.2)
  const depth = Math.min(w, h) * 0.3
  let d = ''
  for (let s = 0; s < depth; s += spacing) {
    d += `M${f(x1 - s)} ${f(y1)}L${f(x1)} ${f(y1 - s)}`
  }
  return `<path d="${d}" stroke="${PALETTE.inkFaint}" stroke-width="0.6" fill="none"/>`
}

function buildingFill(b: RenderBuilding): string {
  if (b.floors >= 12) return PALETTE.buildingTall
  if (b.floors >= 6) return '#dfd8c6'
  return PALETTE.building
}

export function buildChunkSvg(key: string, chunk: RenderChunk, lod: Lod): string {
  const rng = new PRNG(0x5eed ^ key.length)
  const parts: string[] = []

  if (lod === 'city') {
    for (const bl of chunk.blocks) {
      const alpha = bl.use === 'park' ? 0.0 : 0.05 + bl.density * 0.22
      const fill = bl.use === 'park' ? PALETTE.park : `rgba(43,42,38,${alpha.toFixed(3)})`
      parts.push(`<path d="${ringPath(bl.ring)}" fill="${fill}" stroke="none"/>`)
    }
    for (const r of chunk.roads) {
      if (r.roadClass === 'local' || r.roadClass === 'service') continue
      const w = r.roadClass === 'arterial' ? 7 : 4
      parts.push(`<path d="${polyline(r.pts)}" stroke="${PALETTE.inkSoft}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`)
    }
    return `<g data-chunk="${key}" data-lod="city">${parts.join('')}</g>`
  }

  if (lod === 'neighbourhood') {
    for (const bl of chunk.blocks) {
      if (bl.use === 'park') parts.push(`<path d="${ringPath(bl.ring)}" fill="${PALETTE.park}" stroke="none"/>`)
      else if (bl.use === 'construction') parts.push(`<path d="${ringPath(bl.ring)}" fill="${PALETTE.construction}" stroke="none"/>`)
      else parts.push(`<path d="${ringPath(bl.ring)}" fill="rgba(43,42,38,${(0.03 + bl.density * 0.08).toFixed(3)})" stroke="${PALETTE.inkHair}" stroke-width="0.8"/>`)
    }
    for (const r of chunk.roads) {
      const w = r.roadClass === 'arterial' ? r.width : r.roadClass === 'collector' ? r.width * 0.9 : r.width * 0.7
      parts.push(`<path d="${polyline(r.pts)}" stroke="${PALETTE.roadCasing}" stroke-width="${f(w)}" fill="none" stroke-linecap="round"/>`)
      parts.push(`<path d="${polyline(r.pts)}" stroke="${PALETTE.roadFill}" stroke-width="${f(w - 2.2)}" fill="none" stroke-linecap="round"/>`)
    }
    for (const t of chunk.transit) parts.push(`<rect x="${f(t.x - 7)}" y="${f(t.y - 7)}" width="14" height="14" fill="${PALETTE.transit}" opacity="0.8"/>`)
    return `<g data-chunk="${key}" data-lod="neighbourhood">${parts.join('')}</g>`
  }

  // street LOD
  for (const bl of chunk.blocks) {
    if (bl.use === 'construction') continue
    if (bl.use === 'park') continue
    parts.push(`<path d="${ringPath(bl.ring)}" fill="rgba(43,42,38,0.025)" stroke="none"/>`)
  }
  for (const p of chunk.parks) {
    parts.push(`<path d="${ringPath(p.ring)}" fill="${greenFill(p.kind)}" stroke="${PALETTE.inkHair}" stroke-width="0.8"/>`)
    if (!p.kind || p.kind === 'park' || p.kind === 'garden' || p.kind === 'wood' || p.kind === 'forest') parts.push(stipple(p, rng.fork(p.id)))
  }
  for (const t of chunk.trees ?? []) parts.push(tree2d(t.x, t.y))
  for (const c of chunk.construction) {
    parts.push(`<path d="${ringPath(c.ring)}" fill="${PALETTE.construction}" stroke="${PALETTE.constructionHatch}" stroke-width="1" stroke-dasharray="4 3"/>`)
  }
  for (const r of chunk.roads) {
    parts.push(`<path d="${polyline(r.pts)}" stroke="${PALETTE.roadCasing}" stroke-width="${f(r.width)}" fill="none" stroke-linecap="butt"/>`)
  }
  for (const r of chunk.roads) {
    parts.push(`<path d="${polyline(r.pts)}" stroke="${PALETTE.roadFill}" stroke-width="${f(r.width - 1.6)}" fill="none" stroke-linecap="butt"/>`)
    if (r.roadClass === 'arterial') parts.push(`<path d="${polyline(r.pts)}" stroke="${PALETTE.inkFaint}" stroke-width="0.6" fill="none" stroke-dasharray="6 6"/>`)
  }
  for (const b of chunk.buildings) {
    parts.push(`<path d="${ringPath(b.ring)}" fill="${buildingFill(b)}" stroke="${PALETTE.buildingStroke}" stroke-width="0.9"/>`)
    if (b.floors >= 4) parts.push(hatch(b))
  }
  for (const t of chunk.transit) {
    parts.push(`<rect x="${f(t.x - 8)}" y="${f(t.y - 8)}" width="16" height="16" fill="${PALETTE.paper}" stroke="${PALETTE.transit}" stroke-width="1.5"/>`)
    parts.push(`<text x="${f(t.x)}" y="${f(t.y + 3.5)}" font-size="9" text-anchor="middle" fill="${PALETTE.transit}" font-family="Georgia, serif">M</text>`)
  }
  for (const s of chunk.signals) {
    parts.push(`<circle cx="${f(s.x)}" cy="${f(s.y)}" r="2.2" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="0.8"/>`)
  }
  parts.push(roadLabels(chunk))
  parts.push(parkLabels(chunk))
  return `<g data-chunk="${key}" data-lod="street">${parts.join('')}</g>`
}
