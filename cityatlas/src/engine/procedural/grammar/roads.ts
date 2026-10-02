import { PRNG } from '../../seed/prng'
import { hashMix, hashToUnit } from '../../seed/hash'
import type { TileId } from '../../../geo/tiles/tiles'
import type { RoadClass } from '../../../entities/types'
import type { GraphEdge, GraphNode, RenderRoad } from '../../world/chunkTypes'
import { arterialName, ordinal } from './names'

/**
 * Road grammar. Streets are laid on a jittered grid whose vertical lines
 * depend only on the tile column and horizontal lines only on the tile row.
 * That is what makes roads continue seamlessly across chunk boundaries
 * without any inter-chunk communication: every chunk can compute what its
 * neighbours will do.
 */

export interface GridLine { frac: number; roadClass: RoadClass; name: string }

export const ROAD_WIDTH: Record<RoadClass, number> = { arterial: 18, collector: 12, local: 8, service: 5 }
/** Free-flow ground speeds (m/s). */
export const ROAD_SPEED: Record<RoadClass, number> = { arterial: 13.9, collector: 11.1, local: 8.3, service: 5.5 }
export const ROAD_LANES: Record<RoadClass, number> = { arterial: 3, collector: 2, local: 1, service: 1 }

const MIN_SPACING = 0.16

/** Interior line fractions for a column (vertical lines) or row (horizontal). */
export function lineTemplate(globalSeed: string, axis: 'col' | 'row', index: number): GridLine[] {
  const rng = new PRNG(hashMix(globalSeed, axis, index))
  const count = rng.chance(0.2) ? 1 : rng.chance(0.55) ? 2 : 3
  const fracs: number[] = []
  let guard = 0
  while (fracs.length < count && guard++ < 50) {
    const f = rng.range(MIN_SPACING, 1 - MIN_SPACING)
    if (fracs.every((g) => Math.abs(g - f) >= MIN_SPACING)) fracs.push(f)
  }
  fracs.sort((a, b) => a - b)
  return fracs.map((frac, i) => ({
    frac,
    roadClass: rng.chance(0.25) ? 'collector' : 'local',
    name: axis === 'col' ? `${ordinal(i + 1)} Cross` : `${ordinal(i + 1)} Main`,
  }))
}

/** Class of the road running along the west (col) or north (row) edge of a tile line. */
export function edgeLineClass(globalSeed: string, axis: 'col' | 'row', index: number): RoadClass {
  const u = hashToUnit(globalSeed, 'edge', axis, index)
  if (index % 4 === 0 || u < 0.15) return 'arterial'
  return 'collector'
}

export function edgeLineName(globalSeed: string, axis: 'col' | 'row', index: number): string {
  const rng = new PRNG(hashMix(globalSeed, 'edgename', axis, index))
  return edgeLineClass(globalSeed, axis, index) === 'arterial'
    ? arterialName(rng)
    : `${rng.choice(['Old', 'New', 'Upper', 'Lower'])} ${axis === 'col' ? 'Cross' : 'Main'} ${index % 97}`
}

/** Which interior lines are actually present in this tile (superblocks appear where lines drop out). */
export function presentLines(globalSeed: string, tile: TileId, axis: 'col' | 'row'): GridLine[] {
  const index = axis === 'col' ? tile.x : tile.y
  const template = lineTemplate(globalSeed, axis, index)
  const rng = new PRNG(hashMix(globalSeed, 'presence', axis, tile.x, tile.y))
  return template.filter(() => rng.chance(0.86))
}

export function nodeId(x: number, y: number): string {
  return `n${Math.round(x * 10)}_${Math.round(y * 10)}`
}

export interface RoadBuildContext {
  globalSeed: string
  tile: TileId
  minX: number
  minY: number
  size: number
  /** local units per ground metre (1 / groundScale) */
  unitPerMetre: number
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
  roads: RenderRoad[]
}

function addNode(ctx: RoadBuildContext, x: number, y: number): GraphNode {
  const id = nodeId(x, y)
  let n = ctx.nodes.get(id)
  if (!n) { n = { id, x, y, signal: false }; ctx.nodes.set(id, n) }
  return n
}

/**
 * Add a straight road between stations (absolute coordinates along the
 * road's axis). Produces one render road and 1–2 directed graph edges per
 * segment.
 */
export function addStraightRoad(
  ctx: RoadBuildContext,
  roadId: string,
  name: string,
  roadClass: RoadClass,
  axis: 'v' | 'h',
  fixed: number,
  stations: number[],
  oneway = false,
): void {
  const uniq = [...new Set(stations.map((s) => Math.round(s * 10) / 10))].sort((a, b) => a - b)
  const pts: number[] = []
  for (const s of uniq) pts.push(axis === 'v' ? fixed : s, axis === 'v' ? s : fixed)
  ctx.roads.push({ id: roadId, roadClass, pts, width: ROAD_WIDTH[roadClass] * ctx.unitPerMetre, name })
  const speed = ROAD_SPEED[roadClass] * ctx.unitPerMetre
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = addNode(ctx, axis === 'v' ? fixed : uniq[i], axis === 'v' ? uniq[i] : fixed)
    const b = addNode(ctx, axis === 'v' ? fixed : uniq[i + 1], axis === 'v' ? uniq[i + 1] : fixed)
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const edgeAxis = axis === 'v' ? 'ns' : 'ew'
    ctx.edges.push({ id: `${a.id}>${b.id}`, from: a.id, to: b.id, roadId, roadClass, lanes: ROAD_LANES[roadClass], oneway, speedLimit: speed, length, axis: edgeAxis })
    if (!oneway) ctx.edges.push({ id: `${b.id}>${a.id}`, from: b.id, to: a.id, roadId, roadClass, lanes: ROAD_LANES[roadClass], oneway, speedLimit: speed, length, axis: edgeAxis })
  }
}

export interface RoadLayout { xs: number[]; ys: number[] }

/** Build the road network a tile *owns* (west edge, north edge, interior lines). */
export function generateRoadNetwork(ctx: RoadBuildContext): RoadLayout {
  const { globalSeed, tile, minX, minY, size } = ctx
  const maxX = minX + size, maxY = minY + size
  const cols = presentLines(globalSeed, tile, 'col')
  const rows = presentLines(globalSeed, tile, 'row')
  const xs = cols.map((l) => minX + l.frac * size)
  const ys = rows.map((l) => minY + l.frac * size)

  // Neighbours' interior lines split our owned edge roads so nodes match.
  const westYs = presentLines(globalSeed, { ...tile, x: tile.x - 1 }, 'row').map((l) => minY + l.frac * size)
  const northXs = presentLines(globalSeed, { ...tile, y: tile.y - 1 }, 'col').map((l) => minX + l.frac * size)

  const key = `${tile.z}/${tile.x}/${tile.y}`
  addStraightRoad(ctx, `r:${key}:w`, edgeLineName(globalSeed, 'col', tile.x), edgeLineClass(globalSeed, 'col', tile.x), 'v', minX, [minY, ...ys, ...westYs, maxY])
  addStraightRoad(ctx, `r:${key}:n`, edgeLineName(globalSeed, 'row', tile.y), edgeLineClass(globalSeed, 'row', tile.y), 'h', minY, [minX, ...xs, ...northXs, maxX])

  cols.forEach((l, i) => addStraightRoad(ctx, `r:${key}:v${i}`, l.name, l.roadClass, 'v', minX + l.frac * size, [minY, ...ys, maxY]))
  rows.forEach((l, i) => addStraightRoad(ctx, `r:${key}:h${i}`, l.name, l.roadClass, 'h', minY + l.frac * size, [minX, ...xs, maxX]))

  return { xs: [minX, ...xs, maxX], ys: [minY, ...ys, maxY] }
}
