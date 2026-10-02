import { Vector } from './vector'
import { Box } from './box'
import type { Matrix } from './matrix'
import type { Scene } from './scene'

export interface Filter { filter(v: Vector): [Vector, boolean] }

export const CLIP_BOX = new Box(new Vector(-1, -1, -1), new Vector(1, 1, 1))

/** Perspective visibility: a sample survives if nothing lies between it and the eye. */
export class ClipFilter implements Filter {
  constructor(public matrix: Matrix, public eye: Vector, public scene: Scene) {}
  filter(v: Vector): [Vector, boolean] {
    const w = this.matrix.mulPositionW(v)
    if (!this.scene.visible(this.eye, v)) return [w, false]
    if (!CLIP_BOX.contains(w)) return [w, false]
    return [w, true]
  }
}

/**
 * Parallel-projection visibility (an Atlas Infinity addition): rays travel
 * along one direction, so the same scene drawn in two neighbouring tiles
 * lines up exactly. `toward` points from the scene towards the viewer.
 */
export class ParallelClipFilter implements Filter {
  constructor(public matrix: Matrix, public toward: Vector, public scene: Scene, public clip = true) { this.toward = toward.normalize() }
  filter(v: Vector): [Vector, boolean] {
    const w = this.matrix.mulPositionW(v)
    if (!this.scene.visibleAlong(v, this.toward)) return [w, false]
    if (this.clip && !CLIP_BOX.contains(w)) return [w, false]
    return [w, true]
  }
}
