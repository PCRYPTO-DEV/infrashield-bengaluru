import type { CocoSsdLike } from './index'

/**
 * Loads TensorFlow.js and the COCO-SSD model from a CDN only when the
 * camera panel asks for it, so the main bundle never carries them.
 * Both scripts run in the viewer's browser; model weights are fetched by
 * the model library from its own hosting. No frame leaves the device.
 */
const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'
const COCO = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.async = true; s.crossOrigin = 'anonymous'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`could not load ${src}`))
    document.head.appendChild(s)
  })
}

interface CocoGlobal { load(cfg?: { base?: string }): Promise<CocoSsdLike> }

/** Resolves to a detector; `base` picks the smaller mobilenet variant for phones. */
export async function loadCocoSsdFromCdn(base: 'lite_mobilenet_v2' | 'mobilenet_v2' = 'lite_mobilenet_v2'): Promise<CocoSsdLike> {
  await loadScript(TFJS)
  await loadScript(COCO)
  const g = (globalThis as unknown as { cocoSsd?: CocoGlobal }).cocoSsd
  if (!g) throw new Error('coco-ssd did not register')
  return g.load({ base })
}
