import type { LngLat } from '../geo/coordinates/lngLat'
import type { CameraCalibration } from './types'

/**
 * Compute a planar homography from ≥ 4 image→ground correspondences via a
 * least-squares solve of the DLT system. Ground coordinates are lng/lat;
 * for small scenes the local planarity assumption is adequate.
 */
export function solveHomography(pairs: Array<{ px: [number, number]; ground: LngLat }>): number[] {
  if (pairs.length < 4) throw new Error('need at least 4 correspondences')
  // Normalise ground coordinates for conditioning.
  const lng0 = pairs[0].ground.lng, lat0 = pairs[0].ground.lat
  const rows: number[][] = []
  for (const { px: [x, y], ground } of pairs) {
    const X = (ground.lng - lng0) * 1e4, Y = (ground.lat - lat0) * 1e4
    rows.push([-x, -y, -1, 0, 0, 0, x * X, y * X, X])
    rows.push([0, 0, 0, -x, -y, -1, x * Y, y * Y, Y])
  }
  // Solve A h = 0 with h9 = 1 → 8 unknowns least squares (normal equations).
  const n = 8
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0)), Atb = new Array(n).fill(0)
  for (const r of rows) { for (let i = 0; i < n; i++) { Atb[i] -= r[i] * r[8]; for (let j = 0; j < n; j++) AtA[i][j] += r[i] * r[j] } }
  const h = gaussSolve(AtA, Atb)
  // Denormalise: H maps px -> (X,Y) scaled; compose with inverse scaling + offset.
  const H = [...h, 1]
  const S = [1e-4, 0, lng0, 0, 1e-4, lat0, 0, 0, 1]
  return mul3(S, H)
}

export function applyHomography(H: number[], px: number, py: number): LngLat {
  const x = H[0] * px + H[1] * py + H[2], y = H[3] * px + H[4] * py + H[5], w = H[6] * px + H[7] * py + H[8]
  return { lng: x / w, lat: y / w }
}

export function calibration(cameraId: string, pairs: Array<{ px: [number, number]; ground: LngLat }>, position?: LngLat): CameraCalibration {
  return { cameraId, homography: solveHomography(pairs), position }
}

function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return o
}

function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c] || 1e-12
    for (let j = c; j <= n; j++) M[c][j] /= d
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j] }
  }
  return M.map((r) => r[n])
}
