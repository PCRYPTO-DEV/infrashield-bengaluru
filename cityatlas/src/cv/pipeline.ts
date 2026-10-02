import type { Detection, Track, CameraCalibration, ObjectDetector, FrameSource } from './types'
import { Tracker, type TrackerOptions } from './tracker'
import { applyHomography } from './calibration'
import type { UrbanEntity, MovingKind } from '../entities/types'
import { haversineM, type LngLat } from '../geo/coordinates/lngLat'

const LABEL_KIND: Record<string, MovingKind | undefined> = { person: 'pedestrian', car: 'vehicle', truck: 'vehicle', bus: 'vehicle', motorcycle: 'vehicle', bicycle: 'vehicle' }

export interface TrackObservation {
  trackId: number
  kind: MovingKind
  label: string
  position: LngLat
  /** m/s */
  speed: number
  /** radians from east, clockwise */
  heading: number
  /** seconds since the track last moved more than 1 m */
  dwellS: number
  timestamp: number
  confidence: number
}

/**
 * Camera → frame → detector → tracker → stable ids → trajectory → speed →
 * heading → dwell → UrbanEntity stream. The world engine only ever sees
 * the resulting entities; it never touches a model.
 */
export class CameraPipeline {
  private tracker: Tracker
  private lastMoved = new Map<number, { t: number; p: LngLat }>()
  constructor(private calibration: CameraCalibration, trackerOpts?: TrackerOptions) { this.tracker = new Tracker(trackerOpts) }

  /** Process detections for one frame (detector already run). */
  ingest(detections: Detection[], timestamp: number): TrackObservation[] {
    const tracks = this.tracker.update(detections.filter((d) => LABEL_KIND[d.label]), timestamp)
    return tracks.map((t) => this.toObservation(t, timestamp)).filter((o): o is TrackObservation => !!o)
  }

  private toObservation(t: Track, timestamp: number): TrackObservation | null {
    const kind = LABEL_KIND[t.label]
    if (!kind) return null
    // Ground contact point: bottom-centre of the box.
    const foot = (b: typeof t.bbox) => [b.x + b.w / 2, b.y + b.h] as const
    const [fx, fy] = foot(t.bbox)
    const position = applyHomography(this.calibration.homography, fx, fy)
    let speed = 0, heading = 0
    const h = t.history
    if (h.length >= 3) {
      const a = h[Math.max(0, h.length - 4)], b = h[h.length - 1]
      const pa = applyHomography(this.calibration.homography, a.x, a.y + t.bbox.h / 2), pb = applyHomography(this.calibration.homography, b.x, b.y + t.bbox.h / 2)
      const dt = (b.t - a.t) / 1000
      if (dt > 0) { speed = haversineM(pa, pb) / dt; heading = Math.atan2(-(pb.lat - pa.lat), (pb.lng - pa.lng) * Math.cos((pa.lat * Math.PI) / 180)) }
    }
    const lm = this.lastMoved.get(t.id)
    if (!lm || haversineM(lm.p, position) > 1) this.lastMoved.set(t.id, { t: timestamp, p: position })
    const dwellS = (timestamp - (this.lastMoved.get(t.id)!.t)) / 1000
    return { trackId: t.id, kind, label: t.label, position, speed, heading, dwellS, timestamp, confidence: Math.min(0.95, 0.4 + 0.1 * Math.min(5, t.hits)) }
  }

  toEntities(obs: TrackObservation[]): UrbanEntity[] {
    return obs.map((o) => ({
      id: `cam:${this.calibration.cameraId}:${o.trackId}`,
      type: o.kind,
      geometry: { type: 'Point', coordinates: [o.position.lng, o.position.lat] },
      timestamp: o.timestamp,
      properties: { label: o.label, speed: o.speed, heading: o.heading, dwellS: o.dwellS, trackId: o.trackId, cameraId: this.calibration.cameraId },
      evidence: { classification: 'observed', source: `camera:${this.calibration.cameraId}`, timestamp: o.timestamp, confidence: o.confidence, model: 'tracker:sort-lite/1' },
    }))
  }

  /** Drive a frame source with a detector until it ends. */
  async run(source: FrameSource, detector: ObjectDetector, onObservations: (obs: TrackObservation[], entities: UrbanEntity[]) => void, shouldStop: () => boolean = () => false): Promise<void> {
    await detector.load()
    for (;;) {
      if (shouldStop()) return
      const f = await source.next()
      if (!f || !f.frame) return
      const dets = await detector.detect(f.frame, source.width, source.height)
      const obs = this.ingest(dets, f.timestamp)
      onObservations(obs, this.toEntities(obs))
    }
  }
}
