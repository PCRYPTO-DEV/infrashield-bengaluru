import { parseTileKey, tileBounds, tileSizeWorld, CHUNK_ZOOM } from '../../geo/tiles/tiles'
import type { ChunkData, ChunkRequest } from '../world/chunkTypes'
import { edgeLineClass } from './grammar/roads'
import { createCityFields } from './grammar/blocks'
import { Noise } from './noise'
import { hashMix } from '../seed/hash'
import { PRNG } from '../seed/prng'
import { districtName } from './grammar/names'
import { PALETTE } from '../../rendering/palette'

export const DISTRICT_ZOOM = 13

const noiseCache = new Map<string, Noise>()
/** Stroke widths in world units, chosen for the zoom 12–15 range (≈1–4 px). */
const ARTERIAL_W = 44
const COLLECTOR_W = 16
const LABEL_SIZE = 360
const ARTERIAL_COLOUR = 'rgba(43,42,38,0.42)'
const f = (n: number) => (Math.round(n * 10) / 10).toString()

/**
 * City-scale tier. A district chunk is a zoom-13 tile (8×8 street chunks)
 * rendered from the same deterministic grammar inputs — edge-line classes
 * and the city density field — without buildings, graphs or agents. It is
 * two orders of magnitude cheaper than a street chunk and is what the
 * viewer sees beyond the simulated focus area.
 */
export function generateDistrict(req: ChunkRequest): ChunkData {
  const tile = parseTileKey(req.key)
  const frame = req.frame
  const wb = tileBounds(tile)
  const bounds = { minX: wb.minX - frame.originX, minY: wb.minY - frame.originY, maxX: wb.maxX - frame.originX, maxY: wb.maxY - frame.originY }
  let noise = noiseCache.get(req.globalSeed)
  if (!noise) { noise = new Noise(hashMix(req.globalSeed, 'fields')); noiseCache.set(req.globalSeed, noise) }
  const fields = createCityFields(noise, 1 / frame.groundScale)
  const sub = tileSizeWorld(CHUNK_ZOOM)
  const n = Math.pow(2, CHUNK_ZOOM - tile.z)
  const parts: string[] = []
  const x0 = tile.x * n, y0 = tile.y * n
  // Per sub-tile density: the periphery of the infinite city is sparse, the core dense.
  const dens: number[][] = []
  let densitySum = 0
  for (let i = 0; i < n; i++) {
    dens.push([])
    for (let j = 0; j < n; j++) {
      const minX = bounds.minX + i * sub, minY = bounds.minY + j * sub
      const d = fields.density(minX + sub / 2, minY + sub / 2)
      dens[i].push(d)
      densitySum += d
      const g = fields.green(minX + sub / 2, minY + sub / 2)
      const fill = g > 0.66 && d > 0.3 ? PALETTE.park : `rgba(43,42,38,${(0.015 + Math.pow(d, 1.5) * 0.34).toFixed(3)})`
      parts.push(`<rect x="${f(minX)}" y="${f(minY)}" width="${f(sub + 0.5)}" height="${f(sub + 0.5)}" fill="${fill}" shape-rendering="crispEdges"/>`)
    }
  }
  const dAt = (i: number, j: number) => dens[Math.max(0, Math.min(n - 1, i))][Math.max(0, Math.min(n - 1, j))]
  // Road segments grouped into a few paths by class and density bucket (few DOM nodes, many segments).
  const groups: Record<string, string[]> = { arterial: [], major: [], minor: [] }
  const bucket = (cls: string, d: number): string | null => (cls === 'arterial' ? 'arterial' : d >= 0.5 ? 'major' : d >= 0.3 ? 'minor' : null)
  for (let i = 0; i <= n; i++) {
    const cls = edgeLineClass(req.globalSeed, 'col', x0 + i)
    const x = bounds.minX + i * sub
    for (let j = 0; j < n; j++) {
      const b = bucket(cls, Math.max(dAt(i - 1, j), dAt(i, j)))
      if (b) groups[b].push(`M${f(x)} ${f(bounds.minY + j * sub)}v${f(sub)}`)
    }
  }
  for (let j = 0; j <= n; j++) {
    const cls = edgeLineClass(req.globalSeed, 'row', y0 + j)
    const y = bounds.minY + j * sub
    for (let i = 0; i < n; i++) {
      const b = bucket(cls, Math.max(dAt(i, j - 1), dAt(i, j)))
      if (b) groups[b].push(`M${f(bounds.minX + i * sub)} ${f(y)}h${f(sub)}`)
    }
  }
  if (groups.minor.length) parts.push(`<path d="${groups.minor.join('')}" stroke="rgba(43,42,38,0.07)" stroke-width="${COLLECTOR_W}" fill="none"/>`)
  if (groups.major.length) parts.push(`<path d="${groups.major.join('')}" stroke="rgba(43,42,38,0.16)" stroke-width="${COLLECTOR_W}" fill="none"/>`)
  if (groups.arterial.length) parts.push(`<path d="${groups.arterial.join('')}" stroke="${ARTERIAL_COLOUR}" stroke-width="${ARTERIAL_W}" fill="none"/>`)
  const name = districtName(new PRNG(hashMix(req.globalSeed, 'district', req.key)))
  const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2
  const label = `<g class="ca-d-label"><text x="${f(cx)}" y="${f(cy)}" font-size="${LABEL_SIZE}" text-anchor="middle" fill="rgba(43,42,38,0.38)" font-family="Georgia, serif" letter-spacing="${LABEL_SIZE * 0.12}">${name.toUpperCase()}</text></g>`
  const svg = `<g data-district="${req.key}">${parts.join('')}${label}</g>`
  return {
    key: req.key, bounds, entities: [], graph: { nodes: [], edges: [], signals: [] },
    render: { roads: [], buildings: [], parks: [], signals: [], transit: [], construction: [], blocks: [] },
    meta: { density: densitySum / (n * n), vehicleBudget: 0, pedestrianBudget: 0, districtName: name },
    svg: { city: svg, neighbourhood: svg, street: svg }, generatedAt: 0, seed: hashMix(req.globalSeed, req.key, 'district'),
  }
}
