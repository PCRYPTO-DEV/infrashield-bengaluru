import { describe, it, expect } from 'vitest'
import { Tracker, iou } from '../cv/tracker'
import { solveHomography, applyHomography } from '../cv/calibration'
import { CameraPipeline } from '../cv/pipeline'
import { ScriptedDetector } from '../cv/detectors'

describe('computer vision adapter', () => {
  it('tracker keeps stable ids across frames and drops lost tracks', () => {
    const t = new Tracker({ minHits: 1, maxMissed: 1 })
    const f1 = t.update([{ bbox: { x: 0, y: 0, w: 10, h: 10 }, label: 'car', score: 0.9 }], 0)
    const f2 = t.update([{ bbox: { x: 2, y: 0, w: 10, h: 10 }, label: 'car', score: 0.9 }], 100)
    expect(f1[0].id).toBe(f2[0].id)
    expect(f2[0].vx).toBeGreaterThan(0)
    t.update([], 200); t.update([], 300)
    expect(t.active).toBe(0)
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(1 / 3, 5)
  })
  it('homography maps calibration points back to themselves', () => {
    const pairs = [
      { px: [0, 0] as [number, number], ground: { lng: 77.6, lat: 12.97 } },
      { px: [640, 0] as [number, number], ground: { lng: 77.601, lat: 12.97 } },
      { px: [640, 480] as [number, number], ground: { lng: 77.6012, lat: 12.9695 } },
      { px: [0, 480] as [number, number], ground: { lng: 77.5998, lat: 12.9694 } },
    ]
    const H = solveHomography(pairs)
    for (const p of pairs) { const g = applyHomography(H, p.px[0], p.px[1]); expect(g.lng).toBeCloseTo(p.ground.lng, 6); expect(g.lat).toBeCloseTo(p.ground.lat, 6) }
  })
  it('pipeline turns detections into observed entities with speed and heading', async () => {
    const pairs = [
      { px: [0, 0] as [number, number], ground: { lng: 77.6, lat: 12.97 } },
      { px: [640, 0] as [number, number], ground: { lng: 77.601, lat: 12.97 } },
      { px: [640, 480] as [number, number], ground: { lng: 77.601, lat: 12.9695 } },
      { px: [0, 480] as [number, number], ground: { lng: 77.6, lat: 12.9695 } },
    ]
    const pipe = new CameraPipeline({ cameraId: 'cam1', homography: solveHomography(pairs) }, { minHits: 1 })
    const det = new ScriptedDetector([0, 1, 2, 3].map((i) => [{ bbox: { x: 100 + i * 10, y: 200, w: 30, h: 30 }, label: 'car', score: 0.9 }, { bbox: { x: 300, y: 300, w: 10, h: 20 }, label: 'person', score: 0.8 }, { bbox: { x: 0, y: 0, w: 5, h: 5 }, label: 'kite', score: 0.5 }]))
    let frame = 0
    const source = { id: 's', width: 640, height: 480, next: async () => (frame < 4 ? { frame: null as unknown as ImageData, timestamp: 1000 + frame++ * 500 } : null) }
    const seen: ReturnType<CameraPipeline['toEntities']>[] = []
    // scripted frames are null drawables; the scripted detector ignores them
    await pipe.run({ ...source, next: async () => { const f = await source.next(); return f ? { frame: {} as ImageData, timestamp: f.timestamp } : null } }, det, (_o, ents) => seen.push(ents))
    const last = seen[seen.length - 1]
    expect(last.length).toBe(2)
    const car = last.find((e) => e.type === 'vehicle')!
    expect(car.evidence).toMatchObject({ classification: 'observed', source: 'camera:cam1' })
    expect(Number(car.properties.speed)).toBeGreaterThan(0)
    expect(last.find((e) => e.type === 'pedestrian')!.properties.dwellS).toBeGreaterThan(0)
  })
})
