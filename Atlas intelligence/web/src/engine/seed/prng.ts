/**
 * Small, fast, seedable PRNG (mulberry32). Explicit instances instead of a
 * global `Math.random` override: every generator owns its stream, which is
 * what makes chunk generation order-independent and testable.
 */
export class PRNG {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    // Warm up to decorrelate neighbouring seeds.
    for (let i = 0; i < 4; i++) this.next()
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  choice<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /** Approximate standard normal via Box–Muller. */
  gaussian(mean = 0, sd = 1): number {
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** Fork a child stream deterministically from this one's seed and a label. */
  fork(label: string | number): PRNG {
    return new PRNG(hashFork(this.state, label))
  }
}

function hashFork(state: number, label: string | number): number {
  let h = state ^ 0x85ebca6b
  const s = String(label)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
