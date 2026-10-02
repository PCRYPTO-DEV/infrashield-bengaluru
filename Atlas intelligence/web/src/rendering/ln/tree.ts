import { Axis, Box } from './box'
import type { Ray } from './ray'
import { Hit, NO_HIT } from './hit'
import type { Shape } from './shape'
import { median } from './vector'

/** k-d tree over shape bounding boxes (the Go original's Tree/Node). */
export class Tree {
  box: Box
  root: TreeNode
  constructor(shapes: Shape[]) {
    this.box = shapes.length ? shapes.reduce((b, s) => b.extend(s.boundingBox()), shapes[0].boundingBox()) : new Box()
    this.root = new TreeNode(shapes)
    this.root.split(0)
  }
  intersect(r: Ray): Hit {
    const [tmin, tmax] = this.box.intersect(r)
    if (tmax < tmin || tmax <= 0) return NO_HIT
    return this.root.intersect(r, tmin, tmax)
  }
}

export class TreeNode {
  axis: Axis = Axis.None
  point = 0
  left: TreeNode | null = null
  right: TreeNode | null = null
  constructor(public shapes: Shape[] | null) {}

  intersect(r: Ray, tmin: number, tmax: number): Hit {
    let tsplit = 0, leftFirst = false
    switch (this.axis) {
      case Axis.None: return this.intersectShapes(r)
      case Axis.X: tsplit = (this.point - r.origin.x) / r.direction.x; leftFirst = r.origin.x < this.point || (r.origin.x === this.point && r.direction.x <= 0); break
      case Axis.Y: tsplit = (this.point - r.origin.y) / r.direction.y; leftFirst = r.origin.y < this.point || (r.origin.y === this.point && r.direction.y <= 0); break
      case Axis.Z: tsplit = (this.point - r.origin.z) / r.direction.z; leftFirst = r.origin.z < this.point || (r.origin.z === this.point && r.direction.z <= 0); break
    }
    const first = leftFirst ? this.left! : this.right!, second = leftFirst ? this.right! : this.left!
    if (tsplit > tmax || tsplit <= 0) return first.intersect(r, tmin, tmax)
    if (tsplit < tmin) return second.intersect(r, tmin, tmax)
    const h1 = first.intersect(r, tmin, tsplit)
    if (h1.t <= tsplit) return h1
    const h2 = second.intersect(r, tsplit, Math.min(tmax, h1.t))
    return h1.t <= h2.t ? h1 : h2
  }

  intersectShapes(r: Ray): Hit {
    let hit = NO_HIT
    for (const s of this.shapes ?? []) { const h = s.intersect(r); if (h.t < hit.t) hit = h }
    return hit
  }

  partitionScore(axis: Axis, point: number): number {
    let left = 0, right = 0
    for (const s of this.shapes!) { const [l, r] = s.boundingBox().partition(axis, point); if (l) left++; if (r) right++ }
    return Math.max(left, right)
  }

  partition(axis: Axis, point: number): [Shape[], Shape[]] {
    const left: Shape[] = [], right: Shape[] = []
    for (const s of this.shapes!) { const [l, r] = s.boundingBox().partition(axis, point); if (l) left.push(s); if (r) right.push(s) }
    return [left, right]
  }

  split(depth: number): void {
    const shapes = this.shapes!
    if (shapes.length < 8) return
    const xs: number[] = [], ys: number[] = [], zs: number[] = []
    for (const s of shapes) { const b = s.boundingBox(); xs.push(b.min.x, b.max.x); ys.push(b.min.y, b.max.y); zs.push(b.min.z, b.max.z) }
    const asc = (a: number, b: number) => a - b
    xs.sort(asc); ys.sort(asc); zs.sort(asc)
    const mx = median(xs), my = median(ys), mz = median(zs)
    let best = Math.floor(shapes.length * 0.85), bestAxis = Axis.None, bestPoint = 0
    const sx = this.partitionScore(Axis.X, mx); if (sx < best) { best = sx; bestAxis = Axis.X; bestPoint = mx }
    const sy = this.partitionScore(Axis.Y, my); if (sy < best) { best = sy; bestAxis = Axis.Y; bestPoint = my }
    const sz = this.partitionScore(Axis.Z, mz); if (sz < best) { best = sz; bestAxis = Axis.Z; bestPoint = mz }
    if (bestAxis === Axis.None) return
    const [l, r] = this.partition(bestAxis, bestPoint)
    this.axis = bestAxis; this.point = bestPoint
    this.left = new TreeNode(l); this.right = new TreeNode(r)
    this.left.split(depth + 1); this.right.split(depth + 1)
    this.shapes = null
  }
}
