import type { LngLat } from '../geo/coordinates/lngLat'

/** Axis-aligned box in image pixels. */
export interface BBox { x: number; y: number; w: number; h: number }

export interface Detection { bbox: BBox; label: string; score: number }

export interface FrameSource {
  id: string
  width: number
  height: number
  /** Returns the next frame (any drawable) and its capture timestamp, or null at end of stream. */
  next(): Promise<{ frame: CanvasImageSource | ImageData | null; timestamp: number } | null>
}

/** Any object detector (COCO-SSD, YOLO via ONNX, …) implements this. */
export interface ObjectDetector {
  id: string
  load(): Promise<void>
  detect(frame: CanvasImageSource | ImageData, width: number, height: number): Promise<Detection[]>
}

export interface Track {
  id: number
  label: string
  bbox: BBox
  /** px/s */
  vx: number
  vy: number
  age: number
  hits: number
  missed: number
  firstSeen: number
  lastSeen: number
  history: Array<{ t: number; x: number; y: number }>
}

export interface CameraCalibration {
  cameraId: string
  /** 3x3 row-major homography image(px) → ground(lng,lat) */
  homography: number[]
  position?: LngLat
}
