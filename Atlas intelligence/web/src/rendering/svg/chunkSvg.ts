import type { RenderChunk, RenderBuilding, RenderPark } from '../../engine/world/chunkTypes'
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
    parts.push(`<path d="${ringPath(p.ring)}" fill="${PALETTE.park}" stroke="${PALETTE.inkHair}" stroke-width="0.8"/>`)
    parts.push(stipple(p, rng.fork(p.id)))
  }
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
  // Street labels: one per road, placed on the first segment, rotated to the road.
  for (const r of chunk.roads) {
    if (r.pts.length < 4) continue
    const x0 = r.pts[0], y0 = r.pts[1], x1 = r.pts[2], y1 = r.pts[3]
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
    const vertical = Math.abs(x1 - x0) < Math.abs(y1 - y0)
    const rot = vertical ? -90 : 0
    const size = r.roadClass === 'arterial' ? 7 : 5.5
    parts.push(`<text x="${f(mx)}" y="${f(my - 1.5)}" transform="rotate(${rot} ${f(mx)} ${f(my)})" font-size="${size}" text-anchor="middle" fill="${PALETTE.inkSoft}" font-family="Georgia, serif" letter-spacing="0.6">${escapeXml(r.name.toUpperCase())}</text>`)
  }
  return `<g data-chunk="${key}" data-lod="street">${parts.join('')}</g>`
}
