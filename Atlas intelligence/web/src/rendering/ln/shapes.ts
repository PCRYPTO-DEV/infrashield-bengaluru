import { Vector, EPS } from './vector'
import { Box } from './box'
import { Ray } from './ray'
import { Hit, NO_HIT } from './hit'
import type { Shape } from './shape'
import { Paths, type Path } from './path'
import { Tree } from './tree'

export class Cube implements Shape {
  box: Box
  constructor(public min: Vector, public max: Vector) { this.box = new Box(min, max) }
  compile(): void {}
  boundingBox(): Box { return this.box }
  contains(v: Vector, f: number): boolean {
    return !(v.x < this.min.x - f || v.x > this.max.x + f || v.y < this.min.y - f || v.y > this.max.y + f || v.z < this.min.z - f || v.z > this.max.z + f)
  }
  intersect(r: Ray): Hit {
    let n = this.min.sub(r.origin).div(r.direction), f = this.max.sub(r.origin).div(r.direction)
    ;[n, f] = [n.min(f), n.max(f)]
    const t0 = Math.max(n.x, n.y, n.z), t1 = Math.min(f.x, f.y, f.z)
    if (t0 < 1e-3 && t1 > 1e-3) return new Hit(this, t1)
    if (t0 >= 1e-3 && t0 < t1) return new Hit(this, t0)
    return NO_HIT
  }
  paths(): Paths {
    const { x: x1, y: y1, z: z1 } = this.min, { x: x2, y: y2, z: z2 } = this.max
    const V = (x: number, y: number, z: number) => new Vector(x, y, z)
    return Paths.from([
      [V(x1, y1, z1), V(x1, y1, z2)], [V(x1, y1, z1), V(x1, y2, z1)], [V(x1, y1, z1), V(x2, y1, z1)],
      [V(x1, y1, z2), V(x1, y2, z2)], [V(x1, y1, z2), V(x2, y1, z2)], [V(x1, y2, z1), V(x1, y2, z2)],
      [V(x1, y2, z1), V(x2, y2, z1)], [V(x1, y2, z2), V(x2, y2, z2)], [V(x2, y1, z1), V(x2, y1, z2)],
      [V(x2, y1, z1), V(x2, y2, z1)], [V(x2, y1, z2), V(x2, y2, z2)], [V(x2, y2, z1), V(x2, y2, z2)],
    ])
  }
}

export class Triangle implements Shape {
  box!: Box
  constructor(public v1: Vector, public v2: Vector, public v3: Vector) { this.updateBoundingBox() }
  updateBoundingBox(): void { this.box = new Box(this.v1.min(this.v2).min(this.v3), this.v1.max(this.v2).max(this.v3)) }
  compile(): void {}
  boundingBox(): Box { return this.box }
  contains(): boolean { return false }
  intersect(r: Ray): Hit {
    const e1x = this.v2.x - this.v1.x, e1y = this.v2.y - this.v1.y, e1z = this.v2.z - this.v1.z
    const e2x = this.v3.x - this.v1.x, e2y = this.v3.y - this.v1.y, e2z = this.v3.z - this.v1.z
    const px = r.direction.y * e2z - r.direction.z * e2y, py = r.direction.z * e2x - r.direction.x * e2z, pz = r.direction.x * e2y - r.direction.y * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (det > -EPS && det < EPS) return NO_HIT
    const inv = 1 / det
    const tx = r.origin.x - this.v1.x, ty = r.origin.y - this.v1.y, tz = r.origin.z - this.v1.z
    const u = (tx * px + ty * py + tz * pz) * inv
    if (u < 0 || u > 1) return NO_HIT
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
    const v = (r.direction.x * qx + r.direction.y * qy + r.direction.z * qz) * inv
    if (v < 0 || u + v > 1) return NO_HIT
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (d < EPS) return NO_HIT
    return new Hit(this, d)
  }
  paths(): Paths { return Paths.from([[this.v1, this.v2], [this.v2, this.v3], [this.v3, this.v1]]) }
}

export class Mesh implements Shape {
  box: Box
  tree: Tree | null = null
  constructor(public triangles: Triangle[]) { this.box = triangles.length ? triangles.reduce((b, t) => b.extend(t.box), triangles[0].box) : new Box() }
  compile(): void { if (!this.tree) this.tree = new Tree(this.triangles) }
  boundingBox(): Box { return this.box }
  contains(): boolean { return false }
  intersect(r: Ray): Hit { return this.tree!.intersect(r) }
  paths(): Paths { let p = new Paths(); for (const t of this.triangles) p = p.concat(t.paths()); return p }
}

/**
 * Prism: a building footprint extruded from z0 to z1 (Atlas Infinity addition).
 * Paths are the top and bottom outlines plus one vertical per corner; the
 * solid is a triangle mesh (fan-triangulated roof and floor, quad walls), which
 * is exact for convex footprints and a close approximation for the rest.
 */
export class Prism implements Shape {
  private mesh: Mesh
  private outline: Path[]
  constructor(public footprint: Array<{ x: number; y: number }>, public z0: number, public z1: number) {
    const n = footprint.length
    const bottom = footprint.map((p) => new Vector(p.x, p.y, z0)), top = footprint.map((p) => new Vector(p.x, p.y, z1))
    const tris: Triangle[] = []
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      tris.push(new Triangle(bottom[i], bottom[j], top[j]), new Triangle(bottom[i], top[j], top[i]))
    }
    for (let i = 1; i < n - 1; i++) { tris.push(new Triangle(top[0], top[i], top[i + 1])); tris.push(new Triangle(bottom[0], bottom[i + 1], bottom[i])) }
    this.mesh = new Mesh(tris)
    this.outline = [[...top, top[0]], [...bottom, bottom[0]], ...top.map((t, i) => [bottom[i], t])]
  }
  compile(): void { this.mesh.compile() }
  boundingBox(): Box { return this.mesh.box }
  contains(): boolean { return false }
  intersect(r: Ray): Hit { return this.mesh.intersect(r) }
  paths(): Paths { return Paths.from(this.outline) }
}
