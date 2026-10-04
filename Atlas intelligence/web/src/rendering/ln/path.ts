import { Vector } from './vector'
import { Box } from './box'
import type { Matrix } from './matrix'
import type { Filter } from './filter'

export type Path = Vector[]

export function pathBoundingBox(p: Path): Box { return Box.forVectors(p) }
export function pathTransform(p: Path, m: Matrix): Path { return p.map((v) => m.mulPosition(v)) }

/** Resample so no segment is longer than `step` (the original's Chop). */
export function pathChop(p: Path, step: number): Path {
  const result: Path = []
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1], v = b.sub(a), l = v.length()
    if (i === 0) result.push(a)
    for (let d = step; d < l; d += step) result.push(a.add(v.mulScalar(d / l)))
    result.push(b)
  }
  return result
}

/** Keep only the samples the filter accepts, splitting the path where it rejects. */
export function pathFilter(p: Path, f: Filter): Path[] {
  const result: Path[] = []
  let path: Path = []
  for (const v of p) {
    const [w, ok] = f.filter(v)
    if (ok) path.push(w)
    else { if (path.length > 1) result.push(path); path = [] }
  }
  if (path.length > 1) result.push(path)
  return result
}

/** Ramer–Douglas–Peucker, as in the original. */
export function pathSimplify(p: Path, threshold: number): Path {
  if (p.length < 3) return p
  const a = p[0], b = p[p.length - 1]
  let index = -1, distance = 0
  for (let i = 1; i < p.length - 1; i++) { const d = p[i].segmentDistance(a, b); if (d > distance) { index = i; distance = d } }
  if (distance > threshold) {
    const r1 = pathSimplify(p.slice(0, index + 1), threshold), r2 = pathSimplify(p.slice(index), threshold)
    return r1.slice(0, -1).concat(r2)
  }
  return [a, b]
}

export class Paths {
  constructor(public items: Path[] = []) {}
  static from(items: Path[]): Paths { return new Paths(items) }
  push(...p: Path[]): void { this.items.push(...p) }
  concat(other: Paths): Paths { return new Paths(this.items.concat(other.items)) }
  get length(): number { return this.items.length }
  boundingBox(): Box { return this.items.length ? this.items.reduce((b, p) => b.extend(pathBoundingBox(p)), pathBoundingBox(this.items[0])) : new Box() }
  transform(m: Matrix): Paths { return new Paths(this.items.map((p) => pathTransform(p, m))) }
  chop(step: number): Paths { return new Paths(this.items.map((p) => pathChop(p, step))) }
  filter(f: Filter): Paths { const out: Path[] = []; for (const p of this.items) out.push(...pathFilter(p, f)); return new Paths(out) }
  simplify(threshold: number): Paths { return new Paths(this.items.map((p) => pathSimplify(p, threshold))) }
  /** SVG path data in screen space (y already flipped by the caller's matrix if needed). */
  toSvgPathData(digits = 1): string {
    let d = ''
    for (const p of this.items) { for (let i = 0; i < p.length; i++) d += `${i === 0 ? 'M' : 'L'}${p[i].x.toFixed(digits)} ${p[i].y.toFixed(digits)}` }
    return d
  }
  toSvg(width: number, height: number, stroke = 'black', strokeWidth = 1): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(0,${height}) scale(1,-1)"><path d="${this.toSvgPathData(2)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"/></g></svg>`
  }
}
