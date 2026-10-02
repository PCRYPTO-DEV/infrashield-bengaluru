/**
 * Seeded gradient noise (Ken Perlin's 2002 "improved noise", public-domain
 * reference algorithm), re-implemented here with a seedable permutation
 * table. Shan Shui used p5.js's value-noise port; we keep the *role* of
 * noise (continuous fields for placement/density) but not that code.
 */
import { PRNG } from '../seed/prng'

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
]

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

export class Noise {
  private perm: Uint8Array

  constructor(seed: number) {
    const rng = new PRNG(seed)
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i + 1)
      const t = p[i]; p[i] = p[j]; p[j] = t
    }
    this.perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  /** 3D gradient noise in [-1, 1]. */
  noise3(x: number, y: number, z = 0): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
    const u = fade(x), v = fade(y), w = fade(z)
    const p = this.perm
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z
    return lerp(
      lerp(
        lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    )
  }

  /** Noise mapped to [0, 1]. */
  unit(x: number, y: number, z = 0): number {
    return 0.5 + 0.5 * this.noise3(x, y, z)
  }

  /** Fractal Brownian motion, [0, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 0.5, freq = 1, sum = 0, norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.unit(x * freq, y * freq, o * 7.1)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}

function grad(hash: number, x: number, y: number, z: number): number {
  const g = GRAD3[hash % 12]
  return g[0] * x + g[1] * y + g[2] * z
}
