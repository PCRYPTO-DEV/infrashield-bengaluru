import type { Detection, ObjectDetector } from '../types'

/**
 * Detector adapters. The concrete model libraries are optional, heavy
 * dependencies and are NOT bundled; each adapter accepts an injected
 * implementation so the pipeline can be tested with a mock and shipped
 * without pulling in TensorFlow.js or onnxruntime-web.
 */

export interface CocoSsdLike { detect(img: CanvasImageSource | ImageData): Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>> }

export class CocoSsdDetector implements ObjectDetector {
  id = 'coco-ssd'
  constructor(private loader: () => Promise<CocoSsdLike>) {}
  private model?: CocoSsdLike
  async load(): Promise<void> { this.model = await this.loader() }
  async detect(frame: CanvasImageSource | ImageData): Promise<Detection[]> {
    if (!this.model) throw new Error('CocoSsdDetector.load() not called')
    return (await this.model.detect(frame)).map((d) => ({ bbox: { x: d.bbox[0], y: d.bbox[1], w: d.bbox[2], h: d.bbox[3] }, label: d.class, score: d.score }))
  }
}

/** YOLO-family model served through ONNX Runtime Web. The runner is injected (session + pre/post-processing). */
export interface OnnxYoloRunner { run(frame: CanvasImageSource | ImageData, width: number, height: number): Promise<Detection[]> }

export class OnnxYoloDetector implements ObjectDetector {
  id = 'onnx-yolo'
  constructor(private loader: () => Promise<OnnxYoloRunner>) {}
  private runner?: OnnxYoloRunner
  async load(): Promise<void> { this.runner = await this.loader() }
  async detect(frame: CanvasImageSource | ImageData, width: number, height: number): Promise<Detection[]> {
    if (!this.runner) throw new Error('OnnxYoloDetector.load() not called')
    return this.runner.run(frame, width, height)
  }
}

/** Scripted detector for tests and demos. */
export class ScriptedDetector implements ObjectDetector {
  id = 'scripted'
  private i = 0
  constructor(private frames: Detection[][]) {}
  async load(): Promise<void> {}
  async detect(): Promise<Detection[]> { return this.frames[Math.min(this.i++, this.frames.length - 1)] ?? [] }
}
