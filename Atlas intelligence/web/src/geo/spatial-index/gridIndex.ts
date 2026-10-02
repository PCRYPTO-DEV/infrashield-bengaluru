import type { WorldBounds, WorldPoint } from '../projection/mercator'

/**
 * Uniform grid spatial hash. Simple, predictable, and fast for the
 * viewport-sized working sets Atlas Infinity deals with. Items are stored by
 * bounding box; callers refine with exact geometry tests.
 */
export class GridIndex<T> {
  private cells = new Map<string, Set<T>>()
  private boxes = new Map<T, WorldBounds>()

  constructor(public readonly cellSize = 100) {}

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`
  }

  insert(item: T, box: WorldBounds): void {
    this.remove(item)
    this.boxes.set(item, box)
    this.forCells(box, (k) => {
      let s = this.cells.get(k)
      if (!s) { s = new Set(); this.cells.set(k, s) }
      s.add(item)
    })
  }

  remove(item: T): void {
    const box = this.boxes.get(item)
    if (!box) return
    this.forCells(box, (k) => {
      const s = this.cells.get(k)
      if (s) { s.delete(item); if (s.size === 0) this.cells.delete(k) }
    })
    this.boxes.delete(item)
  }

  clear(): void {
    this.cells.clear()
    this.boxes.clear()
  }

  get size(): number {
    return this.boxes.size
  }

  query(box: WorldBounds): T[] {
    const seen = new Set<T>()
    this.forCells(box, (k) => {
      const s = this.cells.get(k)
      if (s) for (const it of s) {
        const b = this.boxes.get(it)!
        if (b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY) seen.add(it)
      }
    })
    return [...seen]
  }

  queryPoint(p: WorldPoint, radius = 0): T[] {
    return this.query({ minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius })
  }

  private forCells(box: WorldBounds, fn: (key: string) => void): void {
    const x0 = Math.floor(box.minX / this.cellSize)
    const y0 = Math.floor(box.minY / this.cellSize)
    const x1 = Math.floor(box.maxX / this.cellSize)
    const y1 = Math.floor(box.maxY / this.cellSize)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(this.key(x, y))
  }
}
