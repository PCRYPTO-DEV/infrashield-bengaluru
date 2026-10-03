import { Vector, INF } from './vector'
import { Matrix } from './matrix'
import { Ray } from './ray'
import { Tree } from './tree'
import type { Shape } from './shape'
import { Paths } from './path'
import { ClipFilter, ParallelClipFilter } from './filter'
import type { Hit } from './hit'

export class Scene {
  shapes: Shape[] = []
  tree: Tree | null = null
  add(shape: Shape): void { this.shapes.push(shape); this.tree = null }
  compile(): void { for (const s of this.shapes) s.compile(); if (!this.tree) this.tree = new Tree(this.shapes) }
  intersect(r: Ray): Hit { return this.tree!.intersect(r) }
  visible(eye: Vector, point: Vector): boolean {
    const v = eye.sub(point)
    const hit = this.intersect(new Ray(point, v.normalize()))
    return hit.t >= v.length()
  }
  /** Nothing within `INF` along `toward` from the point. */
  visibleAlong(point: Vector, toward: Vector): boolean { return this.intersect(new Ray(point, toward)).t >= INF }
  paths(): Paths { let r = new Paths(); for (const s of this.shapes) r = r.concat(s.paths()); return r }

  render(eye: Vector, center: Vector, up: Vector, width: number, height: number, fovy: number, near: number, far: number, step: number): Paths {
    const aspect = width / height
    const matrix = Matrix.lookAt(eye, center, up).perspective(fovy, aspect, near, far)
    return this.renderWithMatrix(matrix, eye, width, height, step)
  }

  renderWithMatrix(matrix: Matrix, eye: Vector, width: number, height: number, step: number): Paths {
    this.compile()
    let paths = this.paths()
    if (step > 0) paths = paths.chop(step)
    paths = paths.filter(new ClipFilter(matrix, eye, this))
    if (step > 0) paths = paths.simplify(1e-6)
    return paths.transform(Matrix.translate(new Vector(1, 1, 0)).scale(new Vector(width / 2, height / 2, 0)))
  }

  /** Parallel (axonometric / oblique) render; `toward` = scene → viewer direction. */
  renderParallel(matrix: Matrix, toward: Vector, step: number, clip = true): Paths {
    this.compile()
    let paths = this.paths()
    if (step > 0) paths = paths.chop(step)
    paths = paths.filter(new ParallelClipFilter(matrix, toward, this, clip))
    if (step > 0) paths = paths.simplify(1e-6)
    return paths
  }
}
