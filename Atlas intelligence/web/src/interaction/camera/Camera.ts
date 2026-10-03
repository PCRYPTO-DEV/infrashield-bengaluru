import { pixelsPerWorldUnit, type WorldBounds, type WorldPoint } from '../../geo/projection/mercator'

export interface ScreenPoint { x: number; y: number }

/**
 * Camera over local world units. Pan/zoom are the only state; the
 * renderers derive an SVG viewBox and a Canvas transform from it.
 */
export class Camera {
  centre: WorldPoint
  zoom: number
  width = 1
  height = 1
  minZoom = 12.5
  maxZoom = 19.5
  private listeners = new Set<() => void>()
  version = 0

  constructor(centre: WorldPoint, zoom: number) { this.centre = { ...centre }; this.zoom = zoom }

  /** pixels per local world unit */
  get scale(): number { return pixelsPerWorldUnit(this.zoom) }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private changed(): void { this.version++; for (const l of this.listeners) l() }

  setSize(w: number, h: number): void { if (w !== this.width || h !== this.height) { this.width = Math.max(1, w); this.height = Math.max(1, h); this.changed() } }

  viewBounds(): WorldBounds {
    const hw = this.width / 2 / this.scale, hh = this.height / 2 / this.scale
    return { minX: this.centre.x - hw, minY: this.centre.y - hh, maxX: this.centre.x + hw, maxY: this.centre.y + hh }
  }

  worldToScreen(p: WorldPoint): ScreenPoint {
    return { x: (p.x - this.centre.x) * this.scale + this.width / 2, y: (p.y - this.centre.y) * this.scale + this.height / 2 }
  }

  screenToWorld(s: ScreenPoint): WorldPoint {
    return { x: (s.x - this.width / 2) / this.scale + this.centre.x, y: (s.y - this.height / 2) / this.scale + this.centre.y }
  }

  panByPixels(dx: number, dy: number): void {
    this.centre = { x: this.centre.x - dx / this.scale, y: this.centre.y - dy / this.scale }
    this.changed()
  }

  /** Zoom keeping the world point under `anchor` fixed on screen. */
  zoomAt(anchor: ScreenPoint, deltaZoom: number): void {
    const before = this.screenToWorld(anchor)
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + deltaZoom))
    const after = this.screenToWorld(anchor)
    this.centre = { x: this.centre.x + (before.x - after.x), y: this.centre.y + (before.y - after.y) }
    this.changed()
  }

  setView(centre: WorldPoint, zoom?: number): void {
    this.centre = { ...centre }
    if (zoom !== undefined) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom))
    this.changed()
  }
}
