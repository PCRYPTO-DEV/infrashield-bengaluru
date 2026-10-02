import { Vector } from './vector'
import type { Ray } from './ray'

export const enum Axis { None = 0, X = 1, Y = 2, Z = 3 }

export class Box {
  constructor(public min: Vector = new Vector(), public max: Vector = new Vector()) {}
  static forVectors(vs: Vector[]): Box {
    if (!vs.length) return new Box()
    let min = vs[0], max = vs[0]
    for (const v of vs) { min = min.min(v); max = max.max(v) }
    return new Box(min, max)
  }
  anchor(a: Vector): Vector { return this.min.add(this.size().mul(a)) }
  center(): Vector { return this.anchor(new Vector(0.5, 0.5, 0.5)) }
  size(): Vector { return this.max.sub(this.min) }
  contains(b: Vector): boolean {
    return this.min.x <= b.x && this.max.x >= b.x && this.min.y <= b.y && this.max.y >= b.y && this.min.z <= b.z && this.max.z >= b.z
  }
  extend(b: Box): Box { return new Box(this.min.min(b.min), this.max.max(b.max)) }
  /** Returns [tmin, tmax] of the ray against the slab box. */
  intersect(r: Ray): [number, number] {
    let x1 = (this.min.x - r.origin.x) / r.direction.x, x2 = (this.max.x - r.origin.x) / r.direction.x
    let y1 = (this.min.y - r.origin.y) / r.direction.y, y2 = (this.max.y - r.origin.y) / r.direction.y
    let z1 = (this.min.z - r.origin.z) / r.direction.z, z2 = (this.max.z - r.origin.z) / r.direction.z
    if (x1 > x2) [x1, x2] = [x2, x1]
    if (y1 > y2) [y1, y2] = [y2, y1]
    if (z1 > z2) [z1, z2] = [z2, z1]
    return [Math.max(x1, y1, z1), Math.min(x2, y2, z2)]
  }
  partition(axis: Axis, point: number): [boolean, boolean] {
    switch (axis) {
      case Axis.X: return [this.min.x <= point, this.max.x >= point]
      case Axis.Y: return [this.min.y <= point, this.max.y >= point]
      case Axis.Z: return [this.min.z <= point, this.max.z >= point]
      default: return [false, false]
    }
  }
}
