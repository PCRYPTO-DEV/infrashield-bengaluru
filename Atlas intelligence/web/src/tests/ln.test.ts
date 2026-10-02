import { describe, it, expect } from 'vitest'
import { Scene, Cube, Prism, Vector, Matrix, Paths, pathChop, pathSimplify } from '../rendering/ln'

const V = (x: number, y: number, z: number) => new Vector(x, y, z)

describe('ln port: maths', () => {
  it('matrix inverse and lookAt behave', () => {
    const m = Matrix.translate(V(1, 2, 3)).scale(V(2, 2, 2))
    const p = m.mulPosition(V(1, 1, 1))
    const back = m.inverse().mulPosition(p)
    expect(back.x).toBeCloseTo(1, 9); expect(back.y).toBeCloseTo(1, 9); expect(back.z).toBeCloseTo(1, 9)
    const la = Matrix.lookAt(V(0, 0, 10), V(0, 0, 0), V(0, 1, 0))
    const c = la.mulPosition(V(0, 0, 0))
    expect(c.z).toBeCloseTo(-10, 6)
  })
  it('chop and simplify round-trip a straight line', () => {
    const chopped = pathChop([V(0, 0, 0), V(10, 0, 0)], 1)
    expect(chopped.length).toBe(11)
    expect(pathSimplify(chopped, 1e-6).length).toBe(2)
  })
})

describe('ln port: hidden-line rendering', () => {
  const render = (scene: Scene) => scene.render(V(4, 3, 6), V(0, 0, 0), V(0, 0, 1), 512, 512, 50, 0.1, 100, 0.05)
  it('a lone cube shows its silhouette and hides nothing it should show', () => {
    const scene = new Scene()
    scene.add(new Cube(V(-1, -1, 0), V(1, 1, 2)))
    const paths = render(scene)
    expect(paths.length).toBeGreaterThanOrEqual(7)
    for (const p of paths.items) for (const v of p) { expect(v.x).toBeGreaterThanOrEqual(0); expect(v.x).toBeLessThanOrEqual(512) }
  })
  it('a cube hidden behind another yields fewer visible paths than two cubes side by side', () => {
    const behind = new Scene()
    behind.add(new Cube(V(-1, -1, 0), V(1, 1, 2)))
    behind.add(new Cube(V(-4, -4, 0), V(-2, -2, 2)))
    const beside = new Scene()
    beside.add(new Cube(V(-1, -1, 0), V(1, 1, 2)))
    beside.add(new Cube(V(-1, 2.5, 0), V(1, 4.5, 2)))
    const sumLen = (p: Paths) => p.items.reduce((s, path) => { let l = 0; for (let i = 1; i < path.length; i++) l += path[i].distance(path[i - 1]); return s + l }, 0)
    expect(sumLen(render(behind))).toBeLessThan(sumLen(render(beside)))
  })
  it('is deterministic', () => {
    const mk = () => { const s = new Scene(); for (let i = 0; i < 5; i++) s.add(new Prism([{ x: i * 3, y: 0 }, { x: i * 3 + 2, y: 0 }, { x: i * 3 + 2, y: 2 }, { x: i * 3, y: 2 }], 0, 1 + i)); return s }
    const a = mk().renderParallel(Matrix.orthographic(-5, 20, -5, 20, -50, 50).mul(Matrix.rotate(V(1, 0, 0), -1.0)), V(0, -1, 1), 0.1, false)
    const b = mk().renderParallel(Matrix.orthographic(-5, 20, -5, 20, -50, 50).mul(Matrix.rotate(V(1, 0, 0), -1.0)), V(0, -1, 1), 0.1, false)
    expect(a.toSvgPathData(3)).toBe(b.toSvgPathData(3))
    expect(a.length).toBeGreaterThan(5)
  })
  it('prism exposes top, bottom and vertical edges and blocks rays', () => {
    const p = new Prism([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], 0, 10)
    expect(p.paths().length).toBe(2 + 4)
    p.compile()
    const hit = p.intersect({ origin: V(2, -5, 5), direction: V(0, 1, 0), position: () => V(0, 0, 0) } as never)
    expect(hit.t).toBeCloseTo(5, 6)
    expect(p.boundingBox().max.z).toBe(10)
  })
})
