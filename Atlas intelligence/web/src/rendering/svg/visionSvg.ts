import type { ChunkData } from '../../engine/world/chunkTypes'
import type { WorldPoint } from '../../geo/projection/mercator'
import { Scene, Prism, Vector, Matrix, Paths, type Path } from '../ln'
import { buildingHeight } from './inkSvg'
import { PALETTE } from '../palette'

/**
 * Atlas Vision: the city drawn from a camera's own eye.
 *
 * Given a calibrated camera (where it stands, where it looks), the known
 * scene (buildings and roads from the resident chunks) is rendered by the
 * fogleman/ln engine as a perspective hidden-line drawing, and the dots
 * tracked by the camera pipeline are projected into the same frame. The
 * video itself is never drawn here: what the viewer sees is the map's
 * knowledge of the place plus moving points, which is exactly what the
 * system stores.
 */
export interface CameraPose {
  /** where the camera stands, local units */
  eye: WorldPoint
  /** height above ground, local units */
  height: number
  /** ground point the camera looks at, local units */
  look: WorldPoint
  /** vertical field of view, degrees */
  fovy: number
}

export interface VisionFrame {
  width: number
  height: number
  /** `<g>` of ink lines in pixel space, y down */
  svg: string
  /** project a ground point (or a point at height z) into pixels; null when behind the camera */
  project(p: WorldPoint, z?: number): { x: number; y: number } | null
  /** how many paths survived hidden-line removal */
  paths: number
}

/** Up is +z in the world frame; x east, y south (left-handed, hence the x flip on output). */
const UP = new Vector(0, 0, 1)

export function cameraMatrix(pose: CameraPose, width: number, height: number): { matrix: Matrix; eye: Vector } {
  const eye = new Vector(pose.eye.x, pose.eye.y, pose.height)
  const center = new Vector(pose.look.x, pose.look.y, 0)
  const matrix = Matrix.lookAt(eye, center, UP).perspective(pose.fovy, width / height, 0.5, 4000)
  return { matrix, eye }
}

/**
 * Render the chunks within `radius` of the camera. `step` is the hidden-line
 * sample spacing in local units; smaller is finer and slower.
 */
export function renderCameraScene(chunks: Iterable<ChunkData>, pose: CameraPose, upm: number, width = 640, height = 360, radius = 320, step = 4): VisionFrame {
  const scene = new Scene()
  const ground: Path[] = []
  const r2 = (radius * upm) ** 2
  const near = (x: number, y: number) => (x - pose.eye.x) ** 2 + (y - pose.eye.y) ** 2 <= r2
  for (const c of chunks) {
    for (const b of c.render.buildings) {
      const pts: Array<{ x: number; y: number }> = []
      for (let i = 0; i < b.ring.length; i += 2) pts.push({ x: b.ring[i], y: b.ring[i + 1] })
      if (pts.length < 3 || !pts.some((p) => near(p.x, p.y))) continue
      scene.add(new Prism(pts, 0, buildingHeight(b, upm)))
    }
    for (const rd of c.render.roads) {
      const v: Vector[] = []
      for (let i = 0; i < rd.pts.length; i += 2) if (near(rd.pts[i], rd.pts[i + 1])) v.push(new Vector(rd.pts[i], rd.pts[i + 1], 0))
      if (v.length > 1) ground.push(v)
    }
  }
  const { matrix, eye } = cameraMatrix(pose, width, height)
  scene.compile()
  // Buildings: full hidden-line pass. Roads: the same visibility test, so a road behind a block is hidden too.
  const rendered = scene.renderWithMatrix(matrix, eye, width, height, step * upm)
  const roads = Paths.from(ground).chop(step * upm).filter({ filter: (v: Vector) => { const w = matrix.mulPositionW(v); return [w, scene.visible(eye, v) && Math.abs(w.x) <= 1 && Math.abs(w.y) <= 1 && Math.abs(w.z) <= 1] } }).simplify(1e-6)
    .transform(Matrix.translate(new Vector(1, 1, 0)).scale(new Vector(width / 2, height / 2, 0)))
  const toData = (p: Paths) => { let d = ''; for (const path of p.items) for (let i = 0; i < path.length; i++) d += `${i === 0 ? 'M' : 'L'}${(width - path[i].x).toFixed(1)} ${(height - path[i].y).toFixed(1)}`; return d }
  const svg = `<g data-vision="scene"><path d="${toData(roads)}" fill="none" stroke="${PALETTE.roadCasing}" stroke-width="1.6" stroke-linecap="round"/><path d="${toData(rendered)}" fill="none" stroke="${PALETTE.ink}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/></g>`
  const project = (p: WorldPoint, z = 0) => {
    const w = matrix.mulPositionW(new Vector(p.x, p.y, z))
    // behind the camera or outside the frustum
    if (w.z < -1 || w.z > 1) return null
    const toEye = eye.sub(new Vector(p.x, p.y, z)), fwd = new Vector(pose.look.x, pose.look.y, 0).sub(eye).normalize()
    if (toEye.normalize().dot(fwd) > 0) return null
    // the world frame is left-handed (x east, y south, z up), so the image comes out mirrored: flip x back
    return { x: width - (w.x + 1) * width / 2, y: height - (w.y + 1) * height / 2 }
  }
  return { width, height, svg, project, paths: rendered.length + roads.length }
}

/** A pose derived from a calibration: stand at `eye`, look at the centre of the calibrated ground points. */
export function poseFromPoints(eye: WorldPoint, groundPoints: WorldPoint[], heightUnits: number, fovy = 58): CameraPose {
  const n = Math.max(1, groundPoints.length)
  const look = { x: groundPoints.reduce((s, p) => s + p.x, 0) / n, y: groundPoints.reduce((s, p) => s + p.y, 0) / n }
  if (groundPoints.length === 0) return { eye, height: heightUnits, look: { x: eye.x, y: eye.y - 50 }, fovy }
  return { eye, height: heightUnits, look, fovy }
}
