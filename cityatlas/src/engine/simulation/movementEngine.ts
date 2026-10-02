import { PRNG } from '../seed/prng'
import { hashMix } from '../seed/hash'
import type { GraphEdge } from '../world/chunkTypes'
import { RoadGraph, type SimChunkPayload } from './roadGraph'
import { signalPhase } from '../procedural/grammar/signals'
import type { SimSnapshot } from './snapshot'
import type { MovingKind } from '../../entities/types'

type Behaviour = 'normal' | 'erratic' | 'wrongSide'

interface Agent {
  id: number
  kind: MovingKind
  edgeId: string
  t: number
  speed: number
  desired: number
  rng: PRNG
  behaviour: Behaviour
  pauseUntil: number
  chunkKey: string
  /** cached position/heading after step */
  x: number
  y: number
  heading: number
}

export interface MovementEngineOptions {
  globalSeed: string
  /** local units per ground metre */
  unitPerMetre: number
  /** fixed integration step in seconds */
  dt?: number
}

const VEHICLE_LENGTH_M = 4.5
const MIN_GAP_M = 2
const HEADWAY_S = 1.2
const A_MAX = 1.8
const B_COMF = 2.5

/**
 * MovementEngine: a deterministic, chunk-aware traffic and pedestrian
 * simulation. All randomness comes from seeded PRNGs; stepping the engine
 * with the same chunk set and the same sequence of (dt, time) calls gives
 * identical results.
 *
 * It is a *simulation*: every agent it emits is classified 'simulated'.
 * Observations (camera tracks, GPS feeds) never enter here; they are a
 * separate stream in the world model.
 */
export class MovementEngine {
  readonly graph = new RoadGraph()
  private agents = new Map<number, Agent>()
  private byEdge = new Map<string, Agent[]>()
  private readonly dt: number
  private readonly unitPerMetre: number
  private timeMs = 0
  private initialised = false

  constructor(private opts: MovementEngineOptions) {
    this.dt = opts.dt ?? 0.1
    this.unitPerMetre = opts.unitPerMetre
  }

  get agentCount(): number { return this.agents.size }
  get time(): number { return this.timeMs }

  reset(timeMs: number): void {
    this.agents.clear()
    this.byEdge.clear()
    this.timeMs = timeMs
    this.initialised = true
    for (const key of [...this.graph.chunkEdges.keys()]) this.spawnForChunk(key)
  }

  addChunk(payload: SimChunkPayload): void {
    this.graph.addChunk(payload)
    this.chunkMeta.set(payload.key, payload.meta)
    if (this.initialised) this.spawnForChunk(payload.key)
  }

  removeChunk(key: string): void {
    for (const a of [...this.agents.values()]) {
      if (a.chunkKey === key || this.graph.edgeChunk.get(a.edgeId) === key) this.agents.delete(a.id)
    }
    this.graph.removeChunk(key)
    this.chunkMeta.delete(key)
  }

  private chunkMeta = new Map<string, SimChunkPayload['meta']>()

  private spawnForChunk(key: string): void {
    const meta = this.chunkMeta.get(key)
    const edgeIds = this.graph.chunkEdges.get(key)
    if (!meta || !edgeIds || edgeIds.length === 0) return
    const rng = new PRNG(hashMix(this.opts.globalSeed, 'spawn', key))
    const spawn = (kind: MovingKind, index: number) => {
      const edgeId = rng.choice(edgeIds)
      const edge = this.graph.edge(edgeId)!
      const id = hashMix(key, kind, index) & 0x7fffffff
      const agentRng = rng.fork(`${kind}${index}`)
      const behaviour: Behaviour = kind === 'vehicle' ? (agentRng.chance(0.04) ? 'erratic' : agentRng.chance(0.006) ? 'wrongSide' : 'normal') : 'normal'
      const desired = kind === 'vehicle' ? edge.speedLimit * agentRng.range(0.8, 1.15) : agentRng.range(1.1, 1.7) * this.unitPerMetre
      const a: Agent = { id, kind, edgeId, t: agentRng.next(), speed: kind === 'vehicle' ? desired * agentRng.range(0.3, 0.9) : desired, desired, rng: agentRng, behaviour, pauseUntil: 0, chunkKey: key, x: 0, y: 0, heading: 0 }
      this.place(a)
      this.agents.set(id, a)
    }
    for (let i = 0; i < meta.vehicleBudget; i++) spawn('vehicle', i)
    for (let i = 0; i < meta.pedestrianBudget; i++) spawn('pedestrian', i)
  }

  /**
   * Advance towards a world time, integrating with the fixed step. Large
   * gaps are covered incrementally: at most `maxSteps` per call, using a
   * coarser step while far behind, so a +40 min jump never blocks the
   * worker for seconds. Call repeatedly until `lag(timeMs) === 0`.
   */
  advanceTo(timeMs: number, maxSteps = 400): void {
    if (!this.initialised) this.reset(timeMs)
    if (timeMs < this.timeMs) { this.reset(timeMs); return }
    let steps = 0
    let behind = (timeMs - this.timeMs) / 1000
    while (behind >= this.dt && steps < maxSteps) {
      const dt = behind > 120 ? 0.5 : this.dt
      this.step(dt, this.timeMs / 1000)
      this.timeMs += dt * 1000
      behind -= dt
      steps++
    }
  }

  /** Seconds of simulation still owed to reach `timeMs`. */
  lag(timeMs: number): number { return Math.max(0, (timeMs - this.timeMs) / 1000) }

  /** One fixed step. Exposed for tests. */
  step(dt: number, timeS: number): void {
    this.rebuildEdgeIndex()
    const incidents = this.graph.activeIncidentsByEdge(timeS * 1000)
    for (const a of this.agents.values()) {
      const edge = this.graph.edge(a.edgeId)
      if (!edge) { this.agents.delete(a.id); continue }
      if (a.kind === 'vehicle') this.stepVehicle(a, edge, dt, timeS, incidents)
      else this.stepPedestrian(a, edge, dt, timeS)
      this.place(a)
    }
  }

  private rebuildEdgeIndex(): void {
    this.byEdge.clear()
    for (const a of this.agents.values()) {
      if (a.kind !== 'vehicle') continue
      let l = this.byEdge.get(a.edgeId)
      if (!l) { l = []; this.byEdge.set(a.edgeId, l) }
      l.push(a)
    }
    for (const l of this.byEdge.values()) l.sort((p, q) => p.t - q.t)
  }

  private leaderGap(a: Agent, edge: GraphEdge): { gap: number; leaderSpeed: number } | null {
    const list = this.byEdge.get(a.edgeId)!
    const i = list.indexOf(a)
    const vl = VEHICLE_LENGTH_M * this.unitPerMetre
    if (i < list.length - 1) {
      const leader = list[i + 1]
      return { gap: (leader.t - a.t) * edge.length - vl, leaderSpeed: leader.speed }
    }
    // Look into the most likely next edge (straight on).
    const next = this.chooseNext(a, edge, true)
    if (next) {
      const l2 = this.byEdge.get(next.id)
      if (l2 && l2.length) return { gap: (1 - a.t) * edge.length + l2[0].t * next.length - vl, leaderSpeed: l2[0].speed }
    }
    return null
  }

  private stepVehicle(a: Agent, edge: GraphEdge, dt: number, timeS: number, incidents: Map<string, { kind: string; severity: number; edgeId: string }>): void {
    const upm = this.unitPerMetre
    // Erratic drivers sometimes stop where they should not.
    if (a.behaviour === 'erratic' && a.pauseUntil < timeS && a.rng.chance(0.004 * dt * 10)) a.pauseUntil = timeS + a.rng.range(20, 70)
    let v0 = Math.min(a.desired, edge.speedLimit * 1.15)
    let obstacleGap = Infinity
    let obstacleSpeed = 0

    const lead = this.leaderGap(a, edge)
    if (lead) { obstacleGap = lead.gap; obstacleSpeed = lead.leaderSpeed }

    // Signals: stop at the stop line when the governing phase is not green.
    const toNode = this.graph.node(edge.to)
    const sig = toNode && toNode.signal ? this.graph.signals.get(edge.to) : undefined
    if (sig) {
      const phase = signalPhase(sig, timeS)
      const distToLine = (1 - a.t) * edge.length - 6 * upm
      if (phase !== edge.axis && distToLine > 0 && distToLine < obstacleGap) { obstacleGap = distToLine; obstacleSpeed = 0 }
    }

    // Incidents: crawl past, queue behind.
    const inc = incidents.get(edge.id)
    if (inc) {
      const tInc = 0.5
      v0 = Math.min(v0, (2 + (1 - inc.severity) * 6) * upm)
      if (a.t < tInc) {
        const d = (tInc - a.t) * edge.length - 3 * upm
        if (d < obstacleGap) { obstacleGap = Math.max(0.1, d); obstacleSpeed = (1 - inc.severity) * 1.5 * upm }
      }
    }

    if (a.pauseUntil > timeS) { v0 = 0 }

    // Intelligent Driver Model.
    const s0 = MIN_GAP_M * upm
    const dv = a.speed - obstacleSpeed
    const sStar = s0 + Math.max(0, a.speed * HEADWAY_S + (a.speed * dv) / (2 * Math.sqrt(A_MAX * B_COMF)))
    const free = v0 <= 0 ? -B_COMF * 2 : 1 - Math.pow(a.speed / v0, 4)
    const inter = obstacleGap === Infinity ? 0 : Math.pow(sStar / Math.max(obstacleGap, 0.1), 2)
    let acc = A_MAX * upm * (free - inter)
    acc = Math.max(-B_COMF * 3 * upm, Math.min(A_MAX * upm, acc))
    a.speed = Math.max(0, a.speed + acc * dt)
    if (obstacleGap !== Infinity && obstacleGap <= 0.3 * upm) a.speed = Math.min(a.speed, Math.max(0, obstacleSpeed))

    let advance = a.speed * dt
    while (advance > 0) {
      const remain = (1 - a.t) * edge.length
      if (advance < remain) { a.t += advance / edge.length; advance = 0; break }
      advance -= remain
      const next = this.chooseNext(a, edge, false)
      if (!next) { a.t = 1; a.speed = 0; break }
      a.edgeId = next.id
      a.t = 0
      edge = next
    }
  }

  private chooseNext(a: Agent, edge: GraphEdge, peek: boolean): GraphEdge | undefined {
    const outs = this.graph.outEdges(edge.to)
    if (outs.length === 0) return undefined
    const reverse = this.graph.reverseId(edge)
    const forward = outs.filter((e) => e.id !== reverse)
    if (forward.length === 0) return outs[0]
    const straight = forward.filter((e) => e.axis === edge.axis)
    if (peek) return straight[0] ?? forward[0]
    const rng = a.rng
    if (a.kind === 'vehicle') {
      if (straight.length && rng.chance(0.62)) return straight[0]
      const weights = forward.map((e) => (e.roadClass === 'arterial' ? 3 : e.roadClass === 'collector' ? 2 : 1))
      const total = weights.reduce((s, w) => s + w, 0)
      let r = rng.next() * total
      for (let i = 0; i < forward.length; i++) { r -= weights[i]; if (r <= 0) return forward[i] }
      return forward[forward.length - 1]
    }
    return rng.choice(forward)
  }

  private stepPedestrian(a: Agent, edge: GraphEdge, dt: number, timeS: number): void {
    if (a.pauseUntil > timeS) { a.speed = 0; return }
    if (a.rng.chance(0.01 * dt * 10)) { a.pauseUntil = timeS + a.rng.range(5, 90); a.speed = 0; return }
    a.speed = a.desired * (0.9 + 0.2 * Math.sin(timeS * 0.7 + a.id))
    let advance = a.speed * dt
    while (advance > 0) {
      const remain = (1 - a.t) * edge.length
      if (advance < remain) { a.t += advance / edge.length; break }
      advance -= remain
      const next = this.chooseNext(a, edge, false)
      if (!next) { a.t = 1; break }
      a.edgeId = next.id
      a.t = 0
      edge = next
    }
  }

  private place(a: Agent): void {
    const edge = this.graph.edge(a.edgeId)
    const ep = edge && this.graph.endpoints(edge)
    if (!edge || !ep) return
    const dx = ep.b.x - ep.a.x, dy = ep.b.y - ep.a.y
    const len = edge.length || 1
    const ux = dx / len, uy = dy / len
    // Left-hand traffic: offset to the left of travel. Left of (ux,uy) in y-down space is (uy, -ux).
    const laneOffset = a.kind === 'vehicle' ? (edge.lanes >= 2 ? 3.2 : 2.0) * this.unitPerMetre : (edge.lanes * 2.2 + 2.5) * this.unitPerMetre
    const side = a.behaviour === 'wrongSide' ? -1 : 1
    const ox = uy * laneOffset * side, oy = -ux * laneOffset * side
    a.x = ep.a.x + dx * a.t + ox
    a.y = ep.a.y + dy * a.t + oy
    a.heading = Math.atan2(uy, ux)
  }

  snapshot(): SimSnapshot {
    const n = this.agents.size
    const ids = new Int32Array(n), kinds = new Uint8Array(n), xs = new Float32Array(n), ys = new Float32Array(n), headings = new Float32Array(n), speeds = new Float32Array(n)
    const edgeIds: string[] = new Array(n)
    let i = 0
    const stats = new Map<string, { c: number; s: number }>()
    for (const a of this.agents.values()) {
      ids[i] = a.id; kinds[i] = a.kind === 'vehicle' ? 0 : 1; xs[i] = a.x; ys[i] = a.y; headings[i] = a.heading; speeds[i] = a.speed; edgeIds[i] = a.edgeId
      if (a.kind === 'vehicle') { const st = stats.get(a.edgeId) ?? { c: 0, s: 0 }; st.c++; st.s += a.speed; stats.set(a.edgeId, st) }
      i++
    }
    const edgeStats: Array<[string, number, number]> = []
    for (const [e, st] of stats) edgeStats.push([e, st.c, st.s / st.c])
    return { time: this.timeMs, count: n, ids, kinds, xs, ys, headings, speeds, edgeIds, edgeStats, classification: 'simulated' }
  }
}
