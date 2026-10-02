import type { BBox, Detection, Track } from './types'

export interface TrackerOptions { iouThreshold?: number; maxMissed?: number; minHits?: number }

export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

/**
 * SORT-style tracker: constant-velocity prediction, greedy IoU matching,
 * stable ids with a tolerance for missed frames. Dependency-free; a Kalman
 * filter or deep re-id can replace `predict`/`match` without touching the
 * pipeline that consumes tracks.
 */
export class Tracker {
  private tracks = new Map<number, Track>()
  private nextId = 1
  private lastTime?: number
  private readonly iouThreshold: number
  private readonly maxMissed: number
  private readonly minHits: number

  constructor(opts: TrackerOptions = {}) {
    this.iouThreshold = opts.iouThreshold ?? 0.3
    this.maxMissed = opts.maxMissed ?? 5
    this.minHits = opts.minHits ?? 2
  }

  update(detections: Detection[], timestamp: number): Track[] {
    const dt = this.lastTime === undefined ? 0 : (timestamp - this.lastTime) / 1000
    this.lastTime = timestamp
    // Predict.
    for (const t of this.tracks.values()) { t.bbox = { ...t.bbox, x: t.bbox.x + t.vx * dt, y: t.bbox.y + t.vy * dt }; t.age++ }
    // Greedy matching by IoU, highest first.
    const pairs: Array<[number, number, number]> = []
    const trackList = [...this.tracks.values()]
    trackList.forEach((t, ti) => detections.forEach((d, di) => { if (d.label === t.label) { const v = iou(t.bbox, d.bbox); if (v >= this.iouThreshold) pairs.push([v, ti, di]) } }))
    pairs.sort((a, b) => b[0] - a[0])
    const usedT = new Set<number>(), usedD = new Set<number>()
    for (const [, ti, di] of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue
      usedT.add(ti); usedD.add(di)
      const t = trackList[ti], d = detections[di]
      const cx0 = t.bbox.x + t.bbox.w / 2, cy0 = t.bbox.y + t.bbox.h / 2
      const cx1 = d.bbox.x + d.bbox.w / 2, cy1 = d.bbox.y + d.bbox.h / 2
      if (dt > 0) { t.vx = 0.6 * t.vx + 0.4 * ((cx1 - cx0) / dt); t.vy = 0.6 * t.vy + 0.4 * ((cy1 - cy0) / dt) }
      t.bbox = { ...d.bbox }; t.hits++; t.missed = 0; t.lastSeen = timestamp
      t.history.push({ t: timestamp, x: cx1, y: cy1 }); if (t.history.length > 120) t.history.shift()
    }
    trackList.forEach((t, ti) => { if (!usedT.has(ti)) { t.missed++; if (t.missed > this.maxMissed) this.tracks.delete(t.id) } })
    detections.forEach((d, di) => {
      if (usedD.has(di)) return
      const id = this.nextId++
      this.tracks.set(id, { id, label: d.label, bbox: { ...d.bbox }, vx: 0, vy: 0, age: 1, hits: 1, missed: 0, firstSeen: timestamp, lastSeen: timestamp, history: [{ t: timestamp, x: d.bbox.x + d.bbox.w / 2, y: d.bbox.y + d.bbox.h / 2 }] })
    })
    return [...this.tracks.values()].filter((t) => t.hits >= this.minHits && t.missed === 0)
  }

  get active(): number { return this.tracks.size }
}
