/**
 * TypeScript port of fogleman/ln (MIT, © 2016 Michael Fogleman), the 3D line
 * art engine. File-for-file with the Go original; see THIRD_PARTY_NOTICES.md.
 */
export class Vector {
  constructor(public x = 0, public y = 0, public z = 0) {}
  static of(x: number, y: number, z: number): Vector { return new Vector(x, y, z) }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) }
  lengthSquared(): number { return this.x * this.x + this.y * this.y + this.z * this.z }
  distance(b: Vector): number { return this.sub(b).length() }
  distanceSquared(b: Vector): number { return this.sub(b).lengthSquared() }
  dot(b: Vector): number { return this.x * b.x + this.y * b.y + this.z * b.z }
  cross(b: Vector): Vector { return new Vector(this.y * b.z - this.z * b.y, this.z * b.x - this.x * b.z, this.x * b.y - this.y * b.x) }
  normalize(): Vector { const d = this.length(); return new Vector(this.x / d, this.y / d, this.z / d) }
  add(b: Vector): Vector { return new Vector(this.x + b.x, this.y + b.y, this.z + b.z) }
  sub(b: Vector): Vector { return new Vector(this.x - b.x, this.y - b.y, this.z - b.z) }
  mul(b: Vector): Vector { return new Vector(this.x * b.x, this.y * b.y, this.z * b.z) }
  div(b: Vector): Vector { return new Vector(this.x / b.x, this.y / b.y, this.z / b.z) }
  mulScalar(b: number): Vector { return new Vector(this.x * b, this.y * b, this.z * b) }
  divScalar(b: number): Vector { return new Vector(this.x / b, this.y / b, this.z / b) }
  min(b: Vector): Vector { return new Vector(Math.min(this.x, b.x), Math.min(this.y, b.y), Math.min(this.z, b.z)) }
  max(b: Vector): Vector { return new Vector(Math.max(this.x, b.x), Math.max(this.y, b.y), Math.max(this.z, b.z)) }
  minComponent(): number { return Math.min(this.x, this.y, this.z) }
  segmentDistance(v: Vector, w: Vector): number {
    const l2 = v.distanceSquared(w)
    if (l2 === 0) return this.distance(v)
    const t = this.sub(v).dot(w.sub(v)) / l2
    if (t < 0) return this.distance(v)
    if (t > 1) return this.distance(w)
    return v.add(w.sub(v).mulScalar(t)).distance(this)
  }
}

export const INF = 1e9
export const EPS = 1e-9
export function radians(deg: number): number { return (deg * Math.PI) / 180 }
export function median(items: number[]): number {
  const n = items.length
  if (n === 0) return 0
  if (n % 2 === 1) return items[(n - 1) / 2]
  return (items[n / 2 - 1] + items[n / 2]) / 2
}
