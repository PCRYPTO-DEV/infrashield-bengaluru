import type { Detection, ObjectDetector, CameraCalibration } from '../types'
import { CameraPipeline, type TrackObservation } from '../pipeline'
import { calibration as makeCalibration } from '../calibration'
import type { LngLat } from '../../geo/coordinates/lngLat'
import type { UrbanEntity } from '../../entities/types'

/**
 * What the camera feature promises, written down where the code can be
 * checked against it. Every path through this module keeps these true.
 */
export const PRIVACY_GUARD = Object.freeze({
  /** frames are read from the <video> element and discarded; nothing is encoded, stored or posted */
  framesLeaveDevice: false,
  framesStored: false,
  /** the only model ever loaded is a general object detector; no face, gait or re-identification model */
  faceModel: false,
  /** detections outside these classes are dropped before tracking */
  labels: ['person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle'] as readonly string[],
})

export type VisionStatus = 'idle' | 'camera' | 'calibrating' | 'loading' | 'running' | 'stopped' | 'error'

export interface VisionStats { frames: number; detections: number; tracks: number; people: number; vehicles: number; fps: number; detectMs: number }

export interface CalibrationPair { px: [number, number]; ground: LngLat }

/**
 * One camera, one session: stream → detector → tracker → observed entities.
 * The session is UI-agnostic; the panel drives it and reads `status`,
 * `stats` and the latest observations.
 */
export class VisionSession {
  status: VisionStatus = 'idle'
  error: string | null = null
  stats: VisionStats = { frames: 0, detections: 0, tracks: 0, people: 0, vehicles: 0, fps: 0, detectMs: 0 }
  pairs: CalibrationPair[] = []
  calibration: CameraCalibration | null = null
  /** where the camera stands, when the user has placed it */
  position: LngLat | null = null
  heightM = 4
  observations: TrackObservation[] = []
  private pipeline: CameraPipeline | null = null
  private stream: MediaStream | null = null
  private stopFlag = false
  private listeners = new Set<() => void>()
  /** image size the calibration pixels refer to */
  frameSize = { width: 640, height: 360 }

  constructor(public readonly cameraId = 'cam-1') {}

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private changed(): void { for (const l of this.listeners) l() }
  private fail(msg: string): void { this.status = 'error'; this.error = msg; this.changed() }

  /** Open the device camera into a video element. Rear camera first on phones. */
  async openCamera(video: HTMLVideoElement): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no camera access (needs HTTPS)')
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      video.srcObject = this.stream
      await video.play()
      this.frameSize = { width: video.videoWidth || 640, height: video.videoHeight || 360 }
      this.status = 'camera'; this.error = null; this.changed()
    } catch (e) { this.fail((e as Error).message) }
  }

  /** Calibration: the same real-world spot clicked in the image and on the map. */
  addPair(px: [number, number], ground: LngLat): void {
    this.pairs.push({ px, ground })
    if (this.pairs.length >= 4) {
      try { this.calibration = makeCalibration(this.cameraId, this.pairs, this.position ?? undefined); this.error = null }
      catch (e) { this.calibration = null; this.error = (e as Error).message }
    }
    if (this.status === 'camera' || this.status === 'idle') this.status = 'calibrating'
    this.changed()
  }
  resetPairs(): void { this.pairs = []; this.calibration = null; this.changed() }
  setPosition(p: LngLat): void { this.position = p; if (this.calibration) this.calibration = { ...this.calibration, position: p }; this.changed() }

  /** A ready-made calibration (demo mode, or one saved earlier). */
  useCalibration(c: CameraCalibration, pairs: CalibrationPair[] = []): void { this.calibration = c; this.pairs = pairs; this.position = c.position ?? this.position; this.changed() }

  /**
   * Run detection on `frames()` until stopped. The frame getter returns a
   * drawable (the video element) or null; nothing about it is retained.
   */
  async run(detector: ObjectDetector, frames: () => CanvasImageSource | ImageData | null, onObservations: (obs: TrackObservation[], entities: UrbanEntity[]) => void, intervalMs = 150): Promise<void> {
    if (!this.calibration) { this.fail('calibrate first: four matching points'); return }
    this.pipeline = new CameraPipeline(this.calibration, { minHits: 2, maxMissed: 8 })
    this.stopFlag = false
    this.status = 'loading'; this.changed()
    try { await detector.load() } catch (e) { this.fail(`detector: ${(e as Error).message}`); return }
    this.status = 'running'; this.changed()
    let lastTick = performance.now(), fpsAcc = 0, fpsN = 0
    while (!this.stopFlag) {
      const frame = frames()
      const t0 = performance.now()
      if (frame) {
        let dets: Detection[] = []
        try { dets = await detector.detect(frame, this.frameSize.width, this.frameSize.height) } catch (e) { this.fail(`detect: ${(e as Error).message}`); return }
        dets = dets.filter((d) => PRIVACY_GUARD.labels.includes(d.label))
        const now = Date.now()
        const obs = this.pipeline.ingest(dets, now)
        this.observations = obs
        const entities = this.pipeline.toEntities(obs)
        this.stats.frames++; this.stats.detections += dets.length; this.stats.tracks = obs.length
        this.stats.people = obs.filter((o) => o.kind === 'pedestrian').length; this.stats.vehicles = obs.length - this.stats.people
        this.stats.detectMs = Math.round(performance.now() - t0)
        onObservations(obs, entities)
      }
      const t = performance.now(); fpsAcc += t - lastTick; lastTick = t; fpsN++
      if (fpsAcc >= 1000) { this.stats.fps = Math.round((fpsN * 1000) / fpsAcc); fpsAcc = 0; fpsN = 0 }
      this.changed()
      await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (performance.now() - t0))))
    }
    this.status = 'stopped'; this.changed()
  }

  stop(): void {
    this.stopFlag = true
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.stream = null
    this.observations = []
    if (this.status !== 'error') this.status = 'stopped'
    this.changed()
  }
}
