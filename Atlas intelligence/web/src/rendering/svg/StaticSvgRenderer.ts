import type { WorldState } from '../CityRenderer'
import type { ChunkData } from '../../engine/world/chunkTypes'
import type { Lod } from '../lod'
import { PALETTE } from '../palette'
import { parseTileKey } from '../../geo/tiles/tiles'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A LOD string, or the Ink 3D tier that replaces `street` in that mode. */
export type Tier = Lod | 'ink'

/** Sort key: tile row (north first), then column east to west. */
export function drawOrder(key: string): number {
  const t = parseTileKey(key)
  return t.y * 1e6 - t.x
}

/**
 * Static geometry renderer. One `<g>` per resident chunk whose innerHTML is
 * the chunk's pre-built SVG string for the current LOD. Pan and zoom only
 * touch the root `viewBox` (the Shan Shui approach); the DOM changes only
 * when a chunk arrives, leaves, or the LOD tier flips.
 */
export class StaticSvgRenderer {
  readonly svg: SVGSVGElement
  private chunksGroup: SVGGElement
  private districtGroup: SVGGElement
  private groups = new Map<string, { g: SVGGElement; lod: Tier; order: number }>()
  private districts = new Map<string, SVGGElement>()
  private lastViewBox = ''
  private lastTier: Tier | null = null
  private visibleLabels = true
  /** Called when a chunk is shown in Ink 3D but has no ink string yet; the host builds it and calls `refresh`. */
  inkProvider: ((chunk: ChunkData) => void) | null = null
  private inkRequested = new Set<string>()

  constructor(container: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg')
    this.svg.setAttribute('class', 'ca-static')
    this.svg.setAttribute('preserveAspectRatio', 'none')
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;background:' + PALETTE.paper
    this.districtGroup = document.createElementNS(SVG_NS, 'g')
    this.chunksGroup = document.createElementNS(SVG_NS, 'g')
    this.svg.appendChild(this.districtGroup)
    this.svg.appendChild(this.chunksGroup)
    container.appendChild(this.svg)
  }

  /** Night: the ink artwork is inverted with its hues kept (invert + hue-rotate) over the deep-night ground; day: paper and ink as drawn. */
  setTheme(theme: 'day' | 'night'): void {
    this.svg.classList.toggle('night', theme === 'night')
    this.svg.style.background = theme === 'night' ? '#071924' : PALETTE.paper
  }

  addChunk(chunk: ChunkData, lod: Lod): void {
    this.removeChunk(chunk.key)
    const g = document.createElementNS(SVG_NS, 'g')
    const tier = this.lastTier ?? lod
    g.innerHTML = this.content(chunk, tier)
    // Painter's order for the oblique 3D tier: north rows first, and within a row east before west,
    // so a tall building in the tile nearer the viewer draws over the tile behind it.
    const order = drawOrder(chunk.key)
    let before: { g: SVGGElement; order: number } | null = null
    for (const e of this.groups.values()) if (e.order > order && (!before || e.order < before.order)) before = e
    this.chunksGroup.insertBefore(g, before?.g ?? null)
    this.groups.set(chunk.key, { g, lod: tier, order })
  }

  /** The chunk's string for a tier; Ink 3D falls back to the street drawing until its ink is built. */
  private content(chunk: ChunkData, tier: Tier): string {
    if (tier === 'ink') {
      if (chunk.svg.ink) return chunk.svg.ink
      if (!this.inkRequested.has(chunk.key) && this.inkProvider) { this.inkRequested.add(chunk.key); this.inkProvider(chunk) }
      return chunk.svg.street
    }
    return chunk.svg[tier]
  }

  /** Re-read a chunk's string (after its ink arrived). */
  refresh(chunk: ChunkData): void {
    const e = this.groups.get(chunk.key)
    this.inkRequested.delete(chunk.key)
    if (e && e.lod === 'ink') e.g.innerHTML = this.content(chunk, 'ink')
  }

  removeChunk(key: string): void {
    const e = this.groups.get(key)
    if (e) { e.g.remove(); this.groups.delete(key) }
    this.inkRequested.delete(key)
  }

  /** The strings currently shown for the chunks whose bounds touch `b` (used by the line-drawing export). */
  shown(keys: Iterable<string>): string[] {
    const out: string[] = []
    for (const k of keys) { const e = this.groups.get(k); if (e) out.push(e.g.innerHTML) }
    return out
  }

  addDistrict(chunk: ChunkData): void {
    this.removeDistrict(chunk.key)
    const g = document.createElementNS(SVG_NS, 'g')
    g.innerHTML = chunk.svg.city
    this.districtGroup.appendChild(g)
    this.districts.set(chunk.key, g)
  }

  removeDistrict(key: string): void { const g = this.districts.get(key); if (g) { g.remove(); this.districts.delete(key) } }

  render(state: WorldState): void {
    const b = state.camera.viewBounds()
    const vb = `${b.minX.toFixed(2)} ${b.minY.toFixed(2)} ${(b.maxX - b.minX).toFixed(2)} ${(b.maxY - b.minY).toFixed(2)}`
    if (vb !== this.lastViewBox) { this.svg.setAttribute('viewBox', vb); this.lastViewBox = vb }
    const tier: Tier = state.mode === 'ink3d' && state.lod === 'street' ? 'ink' : state.lod
    if (tier !== this.lastTier) {
      this.lastTier = tier
      for (const [key, e] of this.groups) {
        const chunk = state.world.chunks.get(key)
        if (chunk && e.lod !== tier) { e.g.innerHTML = this.content(chunk, tier); e.lod = tier }
      }
    }
    const labels = state.layers.labels
    if (labels !== this.visibleLabels) { this.visibleLabels = labels; this.svg.style.setProperty('--ca-label-display', labels ? 'block' : 'none') }
    const showBuildings = state.layers.buildings, showRoads = state.layers.roads
    // At city LOD the district tier carries the picture; street chunks fade so the two tiers read as one.
    const streetOpacity = state.lod === 'city' ? 0.25 : 1
    this.chunksGroup.style.opacity = (showBuildings || showRoads ? streetOpacity : 0.15).toFixed(2)
    // District tier fades out as the street tier takes over.
    const z = state.camera.zoom
    const districtOpacity = z < 14.4 ? 1 : z < 15.4 ? 1 - (z - 14.4) : 0
    this.districtGroup.style.opacity = districtOpacity.toFixed(2)
    this.districtGroup.style.display = districtOpacity > 0 ? '' : 'none'
    // District names only in the band where they fit (one per ~1.2 km tile at ≥ 13).
    this.districtGroup.setAttribute('data-labels', z >= 12.8 && state.layers.labels ? 'on' : 'off')
  }

  dispose(): void { this.svg.remove(); this.groups.clear() }
}
