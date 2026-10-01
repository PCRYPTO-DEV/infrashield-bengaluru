import type { WorldState } from '../CityRenderer'
import type { ChunkData } from '../../engine/world/chunkTypes'
import type { Lod } from '../lod'
import { PALETTE } from '../palette'

const SVG_NS = 'http://www.w3.org/2000/svg'

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
  private groups = new Map<string, { g: SVGGElement; lod: Lod }>()
  private districts = new Map<string, SVGGElement>()
  private lastViewBox = ''
  private lastLod: Lod | null = null
  private visibleLabels = true

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

  addChunk(chunk: ChunkData, lod: Lod): void {
    this.removeChunk(chunk.key)
    const g = document.createElementNS(SVG_NS, 'g')
    g.innerHTML = chunk.svg[lod]
    this.chunksGroup.appendChild(g)
    this.groups.set(chunk.key, { g, lod })
  }

  removeChunk(key: string): void {
    const e = this.groups.get(key)
    if (e) { e.g.remove(); this.groups.delete(key) }
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
    if (state.lod !== this.lastLod) {
      this.lastLod = state.lod
      for (const [key, e] of this.groups) {
        const chunk = state.world.chunks.get(key)
        if (chunk && e.lod !== state.lod) { e.g.innerHTML = chunk.svg[state.lod]; e.lod = state.lod }
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
