import { Vector } from './vector'
export class Ray {
  constructor(public origin: Vector, public direction: Vector) {}
  position(t: number): Vector { return this.origin.add(this.direction.mulScalar(t)) }
}
