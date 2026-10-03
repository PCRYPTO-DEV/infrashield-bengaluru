import { describe, it, expect } from 'vitest'
import { renderCameraScene, poseFromPoints } from '../rendering/svg/visionSvg'
import { VisionSession, PRIVACY_GUARD } from '../cv/vision/VisionSession'
import { ScriptedDetector } from '../cv/detectors'
import { calibration } from '../cv/calibration'
import type { ChunkData, RenderBuilding } from '../engine/world/chunkTypes'

const box = (id: string, x: number, y: number, w: number, h: number, floors: number): RenderBuilding => ({ id, ring: [x, y, x + w, y, x + w, y + h, x, y + h], floors, landUse: 'commercial' })
const chunkWith = (buildings: RenderBuilding[], roads: number[][] = []): ChunkData => ({
  key: '16/1/1', bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 }, entities: [], graph: { nodes: [], edges: [], signals: [] },
  render: { roads: roads.map((pts, i) => ({ id: `r${i}`, roadClass: 'local', pts, width: 6, name: '' })), buildings, parks: [], signals: [], transit: [], construction: [], blocks: [] },
  meta: { density: 0, vehicleBudget: 0, pedestrianBudget: 0, districtName: '' }, svg: { city: '', neighbourhood: '', street: '' }, generatedAt: 0, seed: 0,
})

describe('Atlas Vision: the scene from the camera eye', () => {
  const pose = poseFromPoints({ x: 0, y: 0 }, [{ x: 0, y: -60 }], 4)
  it('looks north by default and puts an eastern building on the right of the frame', () => {
    const east = chunkWith([box('e', 20, -70, 15, 15, 5)])
    const f = renderCameraScene([east], pose, 1, 640, 360)
    expect(f.paths).toBeGreaterThan(0)
    const xs = [...f.svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]))
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeGreaterThan(320)
    // and the ground point straight ahead lands in the frame, below the horizon
    const p = f.project({ x: 0, y: -60 })
    expect(p).not.toBeNull(); expect(p!.x).toBeCloseTo(320, 0); expect(p!.y).toBeCloseTo(180, 0) // the look point is the image centre
    expect(f.project({ x: 0, y: -25 })!.y).toBeGreaterThan(180) // nearer ground is lower in the frame
    expect(f.project({ x: 0, y: 60 })).toBeNull() // behind the camera
  })
  it('hides a building behind another and keeps roads on the ground', () => {
    const front = box('f', -15, -40, 30, 20, 8), back = box('b', -10, -120, 20, 20, 3)
    const a = renderCameraScene([chunkWith([back])], pose, 1), b = renderCameraScene([chunkWith([front, back])], pose, 1)
    const c = renderCameraScene([chunkWith([front])], pose, 1)
    expect(b.paths).toBeLessThan(a.paths + c.paths)
    const r = renderCameraScene([chunkWith([], [[-30, -80, 30, -80]])], pose, 1)
    expect(r.svg).toContain('stroke-linecap="round"'); expect(r.paths).toBe(1)
  })
})

describe('camera counts: dots, not faces', () => {
  const pairs = [
    { px: [0, 0] as [number, number], ground: { lng: 77.2167, lat: 28.6315 } },
    { px: [640, 0] as [number, number], ground: { lng: 77.2177, lat: 28.6315 } },
    { px: [640, 360] as [number, number], ground: { lng: 77.2178, lat: 28.6309 } },
    { px: [0, 360] as [number, number], ground: { lng: 77.2166, lat: 28.6308 } },
  ]
  it('the guard is explicit and the label set has no face class', () => {
    expect(PRIVACY_GUARD.framesLeaveDevice).toBe(false); expect(PRIVACY_GUARD.faceModel).toBe(false)
    expect(PRIVACY_GUARD.labels).not.toContain('face')
  })
  it('turns scripted detections into observed entities and keeps no frame', async () => {
    const s = new VisionSession('demo')
    for (const p of pairs) s.addPair(p.px, p.ground)
    expect(s.calibration).not.toBeNull()
    const frames = Array.from({ length: 6 }, (_, i) => [
      { bbox: { x: 100 + i * 12, y: 200, w: 40, h: 80 }, label: 'person', score: 0.9 },
      { bbox: { x: 400, y: 150 + i * 10, w: 90, h: 50 }, label: 'car', score: 0.8 },
      { bbox: { x: 10, y: 10, w: 20, h: 20 }, label: 'face', score: 0.99 },
    ])
    const seen: string[] = []
    let calls = 0
    const run = s.run(new ScriptedDetector(frames), () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as ImageData), (_obs, ents) => { calls++; for (const e of ents) seen.push(`${e.type}:${e.evidence.source}`); if (calls >= 6) s.stop() }, 1)
    await run
    expect(s.status).toBe('stopped')
    expect(s.stats.frames).toBe(6)
    expect(seen).toContain('pedestrian:camera:demo'); expect(seen).toContain('vehicle:camera:demo')
    expect(seen.some((x) => x.includes('face'))).toBe(false)
    expect(JSON.stringify(s)).not.toMatch(/data:image|Uint8/)
  })
  it('refuses to run without a calibration', async () => {
    const s = new VisionSession('x')
    await s.run(new ScriptedDetector([]), () => null, () => {})
    expect(s.status).toBe('error')
    expect(calibration('x', pairs).homography.length).toBe(9)
  })
})
