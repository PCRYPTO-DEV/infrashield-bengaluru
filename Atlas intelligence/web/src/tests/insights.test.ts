import { describe, it, expect } from 'vitest'
import { deriveInsights, type InsightInput } from '../intelligence/insights/insightEngine'
import { poseCalibration, applyHomography } from '../cv/calibration'

const base: InsightInput = { time: 1_000_000, flow: [], usual: [], incidents: [], hotspots: [], anomalies: [], weather: null, camera: null, zoneEvents: [], unitPerMetre: 1, congestion: null }

describe('insight engine', () => {
  it('says nothing where there are no readings', () => {
    expect(deriveInsights(base)).toEqual([])
  })
  it('ranks worse-than-usual roads above merely slow ones and keeps one line per road', () => {
    const out = deriveInsights({ ...base,
      flow: [{ edgeId: 'a', level: 0.2, name: 'Janpath', point: { x: 0, y: 0 } }, { edgeId: 'b', level: 0.3, name: 'Janpath', point: { x: 1, y: 1 } }, { edgeId: 'c', level: 0.25, name: 'Minto Road', point: { x: 5, y: 5 } }],
      usual: [{ edgeId: 'c', now: 0.25, usual: 0.7, delta: -0.45, samples: 12, name: 'Minto Road', point: { x: 5, y: 5 } }, { edgeId: 'd', now: 0.5, usual: 0.52, delta: -0.02, samples: 12, name: 'Ring Road', point: { x: 9, y: 9 } }] })
    expect(out[0].kind).toBe('usual'); expect(out[0].vars.road).toBe('Minto Road'); expect(out[0].vars.pct).toBe(45)
    expect(out.filter((i) => i.vars.road === 'Janpath')).toHaveLength(1)
    expect(out.find((i) => i.vars.road === 'Ring Road')).toBeUndefined()
    expect(out.every((i) => i.source && i.classification)).toBe(true)
  })
  it('clusters incidents within 500 m and keeps ids stable', () => {
    const inc = (id: string, x: number) => ({ id, kind: 'accident', severity: 0.7, description: 'crash', startTime: 900_000, point: { x, y: 0 }, classification: 'observed' as const, source: 'tomtom' })
    const a = deriveInsights({ ...base, incidents: [inc('1', 0), inc('2', 300), inc('3', 5000)] })
    const b = deriveInsights({ ...base, incidents: [inc('2', 300), inc('1', 0), inc('3', 5000)] })
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
    expect(a.find((i) => i.kind === 'cluster')?.vars.n).toBe(2)
    expect(a.find((i) => i.id === 'incident:3')).toBeDefined()
  })
  it('joins rain with congestion only when both are measured', () => {
    expect(deriveInsights({ ...base, weather: { precipitationMm: 2, source: 'open-meteo' }, congestion: null }).find((i) => i.kind === 'weather')).toBeUndefined()
    expect(deriveInsights({ ...base, weather: { precipitationMm: 2, source: 'open-meteo' }, congestion: 0.5 }).find((i) => i.id === 'weather:rain-slow')).toBeDefined()
  })
})

describe('quick camera placement', () => {
  it('maps the bottom of the picture near the camera and the centre to the look-at point', () => {
    const cam = { lng: 77.2167, lat: 28.6315 }, look = { lng: 77.2167, lat: 28.6318 } // 33 m north
    const c = poseCalibration('cam', cam, look, 4, { width: 1280, height: 720 })
    const centre = applyHomography(c.homography, 640, 360)
    const near = applyHomography(c.homography, 640, 700)
    const m = (p: { lng: number; lat: number }) => Math.hypot((p.lng - cam.lng) * 111320 * Math.cos(cam.lat * Math.PI / 180), (p.lat - cam.lat) * 111320)
    expect(m(centre)).toBeCloseTo(33.4, 0)
    expect(m(near)).toBeLessThan(m(centre))
    expect(centre.lat).toBeGreaterThan(cam.lat)
  })
  it('keeps left and right of the picture on either side of the line of sight', () => {
    const cam = { lng: 77.2167, lat: 28.6315 }, look = { lng: 77.2167, lat: 28.6318 }
    const c = poseCalibration('cam', cam, look, 4, { width: 1280, height: 720 })
    const left = applyHomography(c.homography, 200, 500), right = applyHomography(c.homography, 1080, 500)
    expect(Math.sign(left.lng - cam.lng)).toBe(-Math.sign(right.lng - cam.lng))
    expect(Math.abs((left.lng - cam.lng) + (right.lng - cam.lng))).toBeLessThan(1e-6)
  })
})
