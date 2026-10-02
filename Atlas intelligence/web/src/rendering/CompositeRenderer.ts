import type { CityRenderer, WorldState } from './CityRenderer'
import { StaticSvgRenderer } from './svg/StaticSvgRenderer'
import { DynamicCanvasRenderer } from './canvas/DynamicCanvasRenderer'
import type { ChunkData } from '../engine/world/chunkTypes'
import type { Lod } from './lod'

/** SVG for static illustration + Canvas for everything that moves. */
export class CompositeRenderer implements CityRenderer {
  readonly svg: StaticSvgRenderer
  readonly canvas: DynamicCanvasRenderer
  private currentLod: Lod = 'street'

  constructor(container: HTMLElement) {
    this.svg = new StaticSvgRenderer(container)
    this.canvas = new DynamicCanvasRenderer(container)
  }

  addChunk(chunk: ChunkData): void { this.svg.addChunk(chunk, this.currentLod) }
  refreshChunk(chunk: ChunkData): void { this.svg.refresh(chunk) }
  removeChunk(key: string): void { this.svg.removeChunk(key) }
  addDistrict(chunk: ChunkData): void { this.svg.addDistrict(chunk) }
  removeDistrict(key: string): void { this.svg.removeDistrict(key) }

  render(state: WorldState): void {
    this.currentLod = state.lod
    this.svg.render(state)
    this.canvas.render(state)
  }

  resize(width: number, height: number): void { this.canvas.resize(width, height) }
  dispose(): void { this.svg.dispose(); this.canvas.dispose() }
}
