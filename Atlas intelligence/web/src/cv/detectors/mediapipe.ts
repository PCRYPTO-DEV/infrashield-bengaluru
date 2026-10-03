import type { Detection, ObjectDetector } from '../types'
import { CocoSsdDetector } from './index'
import { loadCocoSsdFromCdn } from './cocoSsdCdn'

/**
 * MediaPipe Tasks Vision object detector (EfficientDet-Lite0, COCO labels),
 * loaded in the browser only when the camera panel starts counting. It runs
 * on the GPU where there is one and is several times faster than the
 * TensorFlow.js model, which stays as the fallback. Neither model knows
 * faces: the label list is the COCO object list, filtered further by the
 * privacy guard before tracking.
 */
const VERSION = '0.10.14'
const BUNDLES = [`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`, `https://unpkg.com/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`]
const WASM = (base: string) => base.replace(/\/vision_bundle\.mjs$/, '/wasm')
const MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'

interface MpDetection { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: Array<{ categoryName: string; score: number }> }
interface MpDetector { detectForVideo(frame: CanvasImageSource, timestampMs: number): { detections: MpDetection[] }; detect(frame: CanvasImageSource | ImageData): { detections: MpDetection[] }; close(): void }
interface MpModule { FilesetResolver: { forVisionTasks(path: string): Promise<unknown> }; ObjectDetector: { createFromOptions(vision: unknown, o: unknown): Promise<MpDetector> } }

export class MediaPipeDetector implements ObjectDetector {
  id = 'mediapipe-efficientdet-lite0'
  private det?: MpDetector
  private lastTs = 0
  async load(): Promise<void> {
    let lastErr: Error | null = null
    for (const url of BUNDLES) {
      try {
        const mod = (await import(/* @vite-ignore */ url)) as MpModule
        const vision = await mod.FilesetResolver.forVisionTasks(WASM(url))
        let det: MpDetector
        try { det = await mod.ObjectDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, scoreThreshold: 0.4, runningMode: 'VIDEO' }) }
        catch { det = await mod.ObjectDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, scoreThreshold: 0.4, runningMode: 'VIDEO' }) }
        this.det = det
        return
      } catch (e) { lastErr = e as Error }
    }
    throw lastErr ?? new Error('MediaPipe could not be loaded')
  }
  async detect(frame: CanvasImageSource | ImageData): Promise<Detection[]> {
    if (!this.det) throw new Error('MediaPipeDetector.load() not called')
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()))
    this.lastTs = ts
    const r = frame instanceof ImageData ? this.det.detect(frame) : this.det.detectForVideo(frame, ts)
    return r.detections.filter((d) => d.boundingBox && d.categories[0]).map((d) => ({ bbox: { x: d.boundingBox!.originX, y: d.boundingBox!.originY, w: d.boundingBox!.width, h: d.boundingBox!.height }, label: d.categories[0].categoryName, score: d.categories[0].score }))
  }
  close(): void { this.det?.close(); this.det = undefined }
}

/** MediaPipe first; the TensorFlow.js COCO-SSD model if it cannot be loaded. Reports which one is running. */
export class BestDetector implements ObjectDetector {
  id = 'auto'
  private inner: ObjectDetector | null = null
  async load(): Promise<void> {
    const mp = new MediaPipeDetector()
    try { await mp.load(); this.inner = mp; this.id = mp.id; return } catch (e) { console.warn('MediaPipe unavailable, using COCO-SSD:', (e as Error).message) }
    const coco = new CocoSsdDetector(() => loadCocoSsdFromCdn())
    await coco.load(); this.inner = coco; this.id = coco.id
  }
  detect(frame: CanvasImageSource | ImageData, w: number, h: number): Promise<Detection[]> { if (!this.inner) throw new Error('BestDetector.load() not called'); return this.inner.detect(frame, w, h) }
}
