import type { Box } from './box'
import type { Ray } from './ray'
import type { Hit } from './hit'
import type { Vector } from './vector'
import type { Paths } from './path'
import { Matrix } from './matrix'

export interface Shape {
  compile(): void
  boundingBox(): Box
  contains(v: Vector, f: number): boolean
  intersect(r: Ray): Hit
  paths(): Paths
}

export class TransformedShape implements Shape {
  inverse: Matrix
  constructor(public shape: Shape, public matrix: Matrix) { this.inverse = matrix.inverse() }
  compile(): void { this.shape.compile() }
  boundingBox(): Box { return this.matrix.mulBox(this.shape.boundingBox()) }
  contains(v: Vector, f: number): boolean { return this.shape.contains(this.inverse.mulPosition(v), f) }
  intersect(r: Ray): Hit { return this.shape.intersect(this.inverse.mulRay(r)) }
  paths(): Paths { return this.shape.paths().transform(this.matrix) }
}
