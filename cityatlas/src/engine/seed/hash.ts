/**
 * Deterministic hashing utilities.
 *
 * Shan Shui hashed the seed string with `charCode * 128^i` (overflows to
 * Infinity for long strings) and then relied on a single global PRNG whose
 * output depended on the *order* in which chunks were generated. Atlas Infinity
 * instead derives an independent 32-bit seed per (globalSeed, tile, time,
 * datasetVersion) tuple so any chunk can be regenerated in isolation.
 */

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mix an arbitrary list of numbers and strings into a 32-bit value. */
export function hashMix(...parts: Array<string | number>): number {
  let h = 0x9e3779b9
  for (const p of parts) {
    const v = typeof p === 'number' ? fnv1a(numberKey(p)) : fnv1a(p)
    h ^= v + 0x9e3779b9 + (h << 6) + (h >>> 2)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = (h ^ (h >>> 16)) >>> 0
  }
  return h >>> 0
}

function numberKey(n: number): string {
  // Integers hash by their decimal form; floats keep full precision.
  return Number.isInteger(n) ? `i${n}` : `f${n}`
}

/** Hash to a float in [0, 1). */
export function hashToUnit(...parts: Array<string | number>): number {
  return hashMix(...parts) / 4294967296
}
