import { Vector } from './vector'
import { Ray } from './ray'
import { Box } from './box'

/** Row-major 4×4, as in the Go original (x00..x33). */
export class Matrix {
  constructor(public m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {}
  static identity(): Matrix { return new Matrix() }
  static translate(v: Vector): Matrix { return new Matrix([1, 0, 0, v.x, 0, 1, 0, v.y, 0, 0, 1, v.z, 0, 0, 0, 1]) }
  static scale(v: Vector): Matrix { return new Matrix([v.x, 0, 0, 0, 0, v.y, 0, 0, 0, 0, v.z, 0, 0, 0, 0, 1]) }
  static rotate(v: Vector, a: number): Matrix {
    v = v.normalize()
    const s = Math.sin(a), c = Math.cos(a), m = 1 - c
    return new Matrix([
      m * v.x * v.x + c, m * v.x * v.y + v.z * s, m * v.z * v.x - v.y * s, 0,
      m * v.x * v.y - v.z * s, m * v.y * v.y + c, m * v.y * v.z + v.x * s, 0,
      m * v.z * v.x + v.y * s, m * v.y * v.z - v.x * s, m * v.z * v.z + c, 0,
      0, 0, 0, 1,
    ])
  }
  static frustum(l: number, r: number, b: number, t: number, n: number, f: number): Matrix {
    const t1 = 2 * n, t2 = r - l, t3 = t - b, t4 = f - n
    return new Matrix([t1 / t2, 0, (r + l) / t2, 0, 0, t1 / t3, (t + b) / t3, 0, 0, 0, (-f - n) / t4, (-t1 * f) / t4, 0, 0, -1, 0])
  }
  static orthographic(l: number, r: number, b: number, t: number, n: number, f: number): Matrix {
    return new Matrix([2 / (r - l), 0, 0, -(r + l) / (r - l), 0, 2 / (t - b), 0, -(t + b) / (t - b), 0, 0, -2 / (f - n), -(f + n) / (f - n), 0, 0, 0, 1])
  }
  static perspective(fovy: number, aspect: number, near: number, far: number): Matrix {
    const ymax = near * Math.tan((fovy * Math.PI) / 360), xmax = ymax * aspect
    return Matrix.frustum(-xmax, xmax, -ymax, ymax, near, far)
  }
  static lookAt(eye: Vector, center: Vector, up: Vector): Matrix {
    up = up.normalize()
    const f = center.sub(eye).normalize()
    const s = f.cross(up).normalize()
    const u = s.cross(f).normalize()
    return new Matrix([s.x, u.x, -f.x, eye.x, s.y, u.y, -f.y, eye.y, s.z, u.z, -f.z, eye.z, 0, 0, 0, 1]).inverse()
  }
  translate(v: Vector): Matrix { return Matrix.translate(v).mul(this) }
  scale(v: Vector): Matrix { return Matrix.scale(v).mul(this) }
  rotate(v: Vector, a: number): Matrix { return Matrix.rotate(v, a).mul(this) }
  perspective(fovy: number, aspect: number, near: number, far: number): Matrix { return Matrix.perspective(fovy, aspect, near, far).mul(this) }
  orthographic(l: number, r: number, b: number, t: number, n: number, f: number): Matrix { return Matrix.orthographic(l, r, b, t, n, f).mul(this) }
  mul(b: Matrix): Matrix {
    const a = this.m, c = b.m, o = new Array<number>(16)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i * 4 + j] = a[i * 4] * c[j] + a[i * 4 + 1] * c[4 + j] + a[i * 4 + 2] * c[8 + j] + a[i * 4 + 3] * c[12 + j]
    return new Matrix(o)
  }
  mulPosition(b: Vector): Vector {
    const a = this.m
    return new Vector(a[0] * b.x + a[1] * b.y + a[2] * b.z + a[3], a[4] * b.x + a[5] * b.y + a[6] * b.z + a[7], a[8] * b.x + a[9] * b.y + a[10] * b.z + a[11])
  }
  mulPositionW(b: Vector): Vector {
    const a = this.m
    const x = a[0] * b.x + a[1] * b.y + a[2] * b.z + a[3], y = a[4] * b.x + a[5] * b.y + a[6] * b.z + a[7], z = a[8] * b.x + a[9] * b.y + a[10] * b.z + a[11], w = a[12] * b.x + a[13] * b.y + a[14] * b.z + a[15]
    return new Vector(x / w, y / w, z / w)
  }
  mulDirection(b: Vector): Vector {
    const a = this.m
    return new Vector(a[0] * b.x + a[1] * b.y + a[2] * b.z, a[4] * b.x + a[5] * b.y + a[6] * b.z, a[8] * b.x + a[9] * b.y + a[10] * b.z).normalize()
  }
  mulRay(r: Ray): Ray { return new Ray(this.mulPosition(r.origin), this.mulDirection(r.direction)) }
  mulBox(box: Box): Box {
    const a = this.m
    const r = new Vector(a[0], a[4], a[8]), u = new Vector(a[1], a[5], a[9]), bb = new Vector(a[2], a[6], a[10]), t = new Vector(a[3], a[7], a[11])
    let xa = r.mulScalar(box.min.x), xb = r.mulScalar(box.max.x), ya = u.mulScalar(box.min.y), yb = u.mulScalar(box.max.y), za = bb.mulScalar(box.min.z), zb = bb.mulScalar(box.max.z)
    ;[xa, xb] = [xa.min(xb), xa.max(xb)]; [ya, yb] = [ya.min(yb), ya.max(yb)]; [za, zb] = [za.min(zb), za.max(zb)]
    return new Box(xa.add(ya).add(za).add(t), xb.add(yb).add(zb).add(t))
  }
  determinant(): number {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = this.m
    return (a00 * a11 * a22 * a33 - a00 * a11 * a23 * a32 + a00 * a12 * a23 * a31 - a00 * a12 * a21 * a33 + a00 * a13 * a21 * a32 - a00 * a13 * a22 * a31
      - a01 * a12 * a23 * a30 + a01 * a12 * a20 * a33 - a01 * a13 * a20 * a32 + a01 * a13 * a22 * a30 - a01 * a10 * a22 * a33 + a01 * a10 * a23 * a32
      + a02 * a13 * a20 * a31 - a02 * a13 * a21 * a30 + a02 * a10 * a21 * a33 - a02 * a10 * a23 * a31 + a02 * a11 * a23 * a30 - a02 * a11 * a20 * a33
      - a03 * a10 * a21 * a32 + a03 * a10 * a22 * a31 - a03 * a11 * a22 * a30 + a03 * a11 * a20 * a32 - a03 * a12 * a20 * a31 + a03 * a12 * a21 * a30)
  }
  inverse(): Matrix {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = this.m
    const d = this.determinant()
    return new Matrix([
      (a12 * a23 * a31 - a13 * a22 * a31 + a13 * a21 * a32 - a11 * a23 * a32 - a12 * a21 * a33 + a11 * a22 * a33) / d,
      (a03 * a22 * a31 - a02 * a23 * a31 - a03 * a21 * a32 + a01 * a23 * a32 + a02 * a21 * a33 - a01 * a22 * a33) / d,
      (a02 * a13 * a31 - a03 * a12 * a31 + a03 * a11 * a32 - a01 * a13 * a32 - a02 * a11 * a33 + a01 * a12 * a33) / d,
      (a03 * a12 * a21 - a02 * a13 * a21 - a03 * a11 * a22 + a01 * a13 * a22 + a02 * a11 * a23 - a01 * a12 * a23) / d,
      (a13 * a22 * a30 - a12 * a23 * a30 - a13 * a20 * a32 + a10 * a23 * a32 + a12 * a20 * a33 - a10 * a22 * a33) / d,
      (a02 * a23 * a30 - a03 * a22 * a30 + a03 * a20 * a32 - a00 * a23 * a32 - a02 * a20 * a33 + a00 * a22 * a33) / d,
      (a03 * a12 * a30 - a02 * a13 * a30 - a03 * a10 * a32 + a00 * a13 * a32 + a02 * a10 * a33 - a00 * a12 * a33) / d,
      (a02 * a13 * a20 - a03 * a12 * a20 + a03 * a10 * a22 - a00 * a13 * a22 - a02 * a10 * a23 + a00 * a12 * a23) / d,
      (a11 * a23 * a30 - a13 * a21 * a30 + a13 * a20 * a31 - a10 * a23 * a31 - a11 * a20 * a33 + a10 * a21 * a33) / d,
      (a03 * a21 * a30 - a01 * a23 * a30 - a03 * a20 * a31 + a00 * a23 * a31 + a01 * a20 * a33 - a00 * a21 * a33) / d,
      (a01 * a13 * a30 - a03 * a11 * a30 + a03 * a10 * a31 - a00 * a13 * a31 - a01 * a10 * a33 + a00 * a11 * a33) / d,
      (a03 * a11 * a20 - a01 * a13 * a20 - a03 * a10 * a21 + a00 * a13 * a21 + a01 * a10 * a23 - a00 * a11 * a23) / d,
      (a12 * a21 * a30 - a11 * a22 * a30 - a12 * a20 * a31 + a10 * a22 * a31 + a11 * a20 * a32 - a10 * a21 * a32) / d,
      (a01 * a22 * a30 - a02 * a21 * a30 + a02 * a20 * a31 - a00 * a22 * a31 - a01 * a20 * a32 + a00 * a21 * a32) / d,
      (a02 * a11 * a30 - a01 * a12 * a30 - a02 * a10 * a31 + a00 * a12 * a31 + a01 * a10 * a32 - a00 * a11 * a32) / d,
      (a01 * a12 * a20 - a02 * a11 * a20 + a02 * a10 * a21 - a00 * a12 * a21 - a01 * a10 * a22 + a00 * a11 * a22) / d,
    ])
  }
}
