import type { WorldState } from '../CityRenderer'
import { PALETTE } from '../palette'
import { signalPhase } from '../../engine/procedural/grammar/signals'
import type { AgentView } from '../../engine/world/WorldModel'
import type { WorldPoint } from '../../geo/projection/mercator'
import type { IncidentProperties } from '../../entities/types'

/** Google Maps colour code for congestion: green, orange, red, dark red. */
export function trafficColour(congestion: number): string {
  return congestion < 0.25 ? PALETTE.trafficFree : congestion < 0.5 ? PALETTE.trafficSlow : congestion < 0.8 ? PALETTE.trafficCongested : PALETTE.trafficJammed
}

/**
 * High-frequency layer: agents, traces, predictions, overlays, zones,
 * selection. Draws in world units through a single transform so geometry
 * is never re-projected on the CPU. Positions are extrapolated from the
 * last snapshot using speed and heading, so 10 Hz snapshots render at 60.
 */
export class DynamicCanvasRenderer {
  readonly canvas: HTMLCanvasElement
  /** Colours for the moving layer; swapped by theme. Traffic colours (trafficColour) never change. */
  private c: Record<keyof typeof PALETTE, string> = { ...PALETTE }
  setTheme(theme: 'day' | 'night'): void {
    this.c = theme === 'night'
      ? { ...PALETTE, paper: '#071924', ink: '#eef5f8', inkSoft: 'rgba(238,245,248,0.7)', inkFaint: 'rgba(238,245,248,0.35)', inkHair: 'rgba(238,245,248,0.14)', observed: '#7ed957', derived: '#00c2a8', derivedSoft: 'rgba(0,194,168,0.22)', predicted: '#b7a6ff', predictedSoft: 'rgba(183,166,255,0.25)', simulated: '#ff9f43', simulatedSoft: 'rgba(255,159,67,0.18)', risk: '#ff5a5f', riskSoft: 'rgba(255,90,95,0.2)', activity: '#ff9f43', activitySoft: 'rgba(255,159,67,0.25)', vehicle: '#eef5f8', pedestrian: '#7ed957', transit: '#3d8bff' }
      : { ...PALETTE }
  }
  private ctx: CanvasRenderingContext2D
  private dpr = 1

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d', { alpha: true })!
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr))
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr))
  }

  render(s: WorldState): void {
    const ctx = this.ctx
    const cam = s.camera
    const k = cam.scale
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * (cam.width / 2 - cam.centre.x * k), this.dpr * (cam.height / 2 - cam.centre.y * k))
    const px = 1 / k // one screen pixel in world units
    const upm = s.world.unitPerMetre
    const bounds = cam.viewBounds()
    const inView = (p: WorldPoint, pad = 0) => p.x >= bounds.minX - pad && p.x <= bounds.maxX + pad && p.y >= bounds.minY - pad && p.y <= bounds.maxY + pad
    const extrapolate = Math.max(0, Math.min(0.35, (s.time - s.world.snapshotTime) / 1000))

    // ---- derived overlays (under agents) ----
    if (s.layers.density && s.intel.density) this.drawDensity(ctx, s, inView)
    if (s.layers.activity && s.intel.activity) this.drawActivity(ctx, s, inView, px)
    if (s.layers.flow && s.intel.flow) this.drawFlow(ctx, s, px, inView)
    if (s.layers.forecast && s.intel.forecast) this.drawForecast(ctx, s, px, inView)
    if (s.layers.risk && s.intel.risk) this.drawRisk(ctx, s, px, inView, upm)

    // ---- zones ----
    if (s.layers.zones) for (const z of s.zones) {
      if (z.ring.length < 3) continue
      ctx.beginPath(); z.ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath()
      ctx.fillStyle = z.restricted ? this.c.riskSoft : this.c.derivedSoft
      ctx.fill()
      ctx.lineWidth = 1.2 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = z.restricted ? this.c.risk : this.c.derived; ctx.stroke(); ctx.setLineDash([])
      this.label(ctx, z.name, z.ring[0], px, z.restricted ? this.c.risk : this.c.derived)
    }

    // ---- uploaded layers (observed) ----
    if (s.layers.uploads) for (const layer of s.world.layers.values()) {
      if (!layer.visible) continue
      for (const e of layer.entities) {
        const ie = s.world.entities.get(e.id); if (!ie || !inView(ie.local[0], 20)) continue
        const g = ie.entity.geometry.type
        ctx.strokeStyle = layer.colour; ctx.fillStyle = layer.colour; ctx.lineWidth = 1.5 * px
        if (g === 'Point') { const p = ie.local[0]; const r = 4 * px; ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill() }
        else { ctx.beginPath(); ie.local.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (g === 'Polygon' || g === 'MultiPolygon') { ctx.closePath(); ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1 } ctx.stroke() }
      }
    }

    // ---- signals (phase colour) ----
    if (s.layers.signals && s.lod === 'street') {
      const t = s.time / 1000
      for (const [nodeId, props] of s.world.graph.signals) {
        const n = s.world.graph.node(nodeId); if (!n || !inView(n)) continue
        const phase = signalPhase(props, t)
        const r = 1.6 * upm
        ctx.beginPath(); ctx.arc(n.x + 4 * upm, n.y - 4 * upm, r, 0, Math.PI * 2); ctx.fillStyle = phase === 'ns' ? this.c.signalGreen : phase === 'ew' ? this.c.signalRed : this.c.activity; ctx.fill()
        ctx.beginPath(); ctx.arc(n.x - 4 * upm, n.y + 4 * upm, r, 0, Math.PI * 2); ctx.fillStyle = phase === 'ew' ? this.c.signalGreen : phase === 'ns' ? this.c.signalRed : this.c.activity; ctx.fill()
      }
    }

    // ---- agents ----
    const agents = s.world.agents
    if (s.lod === 'street') {
      if (s.layers.vehicles || s.layers.pedestrians) for (const a of agents.values()) {
        if (a.kind === 'vehicle' ? !s.layers.vehicles : !s.layers.pedestrians) continue
        if (!inView(a, 20)) continue
        this.drawAgent(ctx, a, extrapolate, upm, px, s)
      }
    } else {
      ctx.fillStyle = s.lod === 'city' ? this.c.inkFaint : this.c.inkSoft
      const r = s.lod === 'city' ? 0.8 * px : 1.2 * px
      for (const a of agents.values()) {
        if (a.kind !== 'vehicle' || !s.layers.vehicles || !inView(a)) continue
        const x = a.x + Math.cos(a.heading) * a.speed * extrapolate, y = a.y + Math.sin(a.heading) * a.speed * extrapolate
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
      }
    }

    // ---- camera-observed agents: solid ink dots with a halo, at every LOD ----
    for (const a of s.world.observedAgents.values()) {
      if (!inView(a, 20)) continue
      ctx.beginPath(); ctx.arc(a.x, a.y, 5 * px, 0, Math.PI * 2); ctx.strokeStyle = this.c.observed; ctx.lineWidth = 1 * px; ctx.stroke()
      ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(0.9 * upm, 2.4 * px), 0, Math.PI * 2); ctx.fillStyle = this.c.observed; ctx.fill()
    }

    // ---- incidents: contour rings, not alarming markers ----
    if (s.layers.incidents) for (const inc of s.world.activeIncidents(s.time)) {
      if (!inView(inc.point, 60)) continue
      this.drawIncident(ctx, inc.point, inc.props, s, px, upm)
    }

    // ---- anomalies ----
    if (s.layers.anomalies) for (const a of s.intel.anomalies) {
      if (!inView(a.location, 40)) continue
      const r = (6 + a.severity * 10) * upm
      ctx.beginPath(); ctx.arc(a.location.x, a.location.y, r, 0, Math.PI * 2)
      ctx.strokeStyle = this.c.derived; ctx.lineWidth = 1 * px; ctx.setLineDash([3 * px, 3 * px]); ctx.stroke(); ctx.setLineDash([])
      if (s.lod === 'street') this.label(ctx, a.type.replace('_', ' '), { x: a.location.x + r, y: a.location.y - r }, px, this.c.derived)
    }

    // ---- predictions ----
    if (s.layers.predictions) for (const p of s.intel.predictions.values()) this.drawPrediction(ctx, p.path, p.envelope, p.confidence, s, px, p.alternatives)

    // ---- route ----
    if (s.route) {
      ctx.beginPath(); s.route.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.strokeStyle = this.c.paper; ctx.lineWidth = 6 * px; ctx.stroke()
      ctx.strokeStyle = this.c.derived; ctx.lineWidth = 3 * px; ctx.setLineDash([10 * px, 6 * px]); ctx.lineDashOffset = -(s.wallClock / 40) * px; ctx.stroke(); ctx.setLineDash([])
    }
    for (const p of s.routePick) { ctx.beginPath(); ctx.arc(p.x, p.y, 5 * px, 0, Math.PI * 2); ctx.fillStyle = this.c.derived; ctx.fill() }

    // ---- drawing in progress ----
    if (s.drawing) this.drawDrawing(ctx, s, px)

    // ---- highlights from Ask ----
    for (const p of s.highlights.points) {
      const pulse = 0.5 + 0.5 * Math.sin(s.wallClock / 500)
      ctx.beginPath(); ctx.arc(p.x, p.y, (8 + pulse * 4) * px, 0, Math.PI * 2); ctx.strokeStyle = this.c.selection; ctx.lineWidth = 1.5 * px; ctx.stroke()
    }
    for (const id of s.highlights.entityIds) this.outlineEntity(ctx, s, id, this.c.selection, px)

    // ---- hover / selection ----
    if (s.hover && !(s.selection && sameSel(s.hover, s.selection))) this.drawSelection(ctx, s, s.hover, this.c.inkSoft, px, extrapolate)
    if (s.selection) this.drawSelection(ctx, s, s.selection, this.c.selection, px, extrapolate)

    // ---- simulation-mode treatment: distinct, calm vignette ----
    if (s.temporal.mode === 'simulation') {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const g = ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height / 2, Math.min(this.canvas.width, this.canvas.height) * 0.35, this.canvas.width / 2, this.canvas.height / 2, Math.max(this.canvas.width, this.canvas.height) * 0.75)
      g.addColorStop(0, 'rgba(138,90,134,0)'); g.addColorStop(1, 'rgba(138,90,134,0.18)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    } else if (s.temporal.mode === 'historical') {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = 'rgba(43,42,38,0.06)'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }

  private drawAgent(ctx: CanvasRenderingContext2D, a: AgentView, ex: number, upm: number, px: number, s: WorldState): void {
    const x = a.x + Math.cos(a.heading) * a.speed * ex, y = a.y + Math.sin(a.heading) * a.speed * ex
    const observed = a.evidence.classification === 'observed'
    if (a.kind === 'vehicle') {
      // directional trace
      const h = a.history
      if (h.length > 1 && s.mode !== 'reality') {
        ctx.beginPath(); ctx.moveTo(x, y)
        for (let i = h.length - 1; i >= Math.max(0, h.length - 6); i--) ctx.lineTo(h[i].x, h[i].y)
        ctx.strokeStyle = 'rgba(43,42,38,0.18)'; ctx.lineWidth = 1.2 * upm; ctx.stroke()
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(a.heading)
      // true size is 4.4 × 2 m; never smaller than 7 × 3 screen pixels so motion stays legible
      const L = Math.max(4.4 * upm, 7 * px), W = Math.max(2 * upm, 3 * px)
      ctx.fillStyle = observed ? this.c.observed : this.c.vehicle
      ctx.beginPath(); ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.25); ctx.fill()
      ctx.fillStyle = this.c.paper; ctx.fillRect(L * 0.1, -W / 2 + W * 0.15, L * 0.2, W * 0.7)
      ctx.restore()
    } else {
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.55 * upm, 1.6 * px), 0, Math.PI * 2); ctx.fillStyle = this.c.pedestrian; ctx.fill()
    }
  }

  private drawIncident(ctx: CanvasRenderingContext2D, p: WorldPoint, props: IncidentProperties, s: WorldState, px: number, upm: number): void {
    // An accident or closure is the one thing on the map that must never be missed: a filled halo that
    // grows with severity, three travelling rings, a solid core and a label pill.
    const phase = (s.wallClock / 2400) % 1
    const base = (14 + 30 * props.severity) * upm
    ctx.beginPath(); ctx.arc(p.x, p.y, base, 0, Math.PI * 2); ctx.fillStyle = this.c.riskSoft; ctx.fill()
    for (let i = 0; i < 3; i++) {
      const f = (phase + i / 3) % 1
      ctx.beginPath(); ctx.arc(p.x, p.y, base * (0.4 + f * 1.4), 0, Math.PI * 2)
      ctx.strokeStyle = this.c.risk; ctx.globalAlpha = 0.7 * (1 - f); ctx.lineWidth = 2 * px; ctx.stroke(); ctx.globalAlpha = 1
    }
    const core = Math.max(5 * px, 4 * upm)
    ctx.beginPath(); ctx.arc(p.x, p.y, core, 0, Math.PI * 2); ctx.fillStyle = this.c.risk; ctx.fill(); ctx.strokeStyle = this.c.paper; ctx.lineWidth = 2 * px; ctx.stroke()
    if (s.lod !== 'city') this.pill(ctx, props.kind.replace(/_/g, ' '), { x: p.x + core + 4 * px, y: p.y }, px, this.c.risk, this.c.paper)
  }

  private drawPrediction(ctx: CanvasRenderingContext2D, path: WorldPoint[], envelope: number[], confidence: number, s: WorldState, px: number, alternatives: Array<{ path: WorldPoint[]; probability: number }>): void {
    if (path.length < 2) return
    // confidence envelope: translucent band widening with time
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (let i = 1; i < path.length; i++) {
      ctx.beginPath(); ctx.moveTo(path[i - 1].x, path[i - 1].y); ctx.lineTo(path[i].x, path[i].y)
      ctx.strokeStyle = `rgba(111,102,163,${(0.16 * confidence * (1 - i / path.length)).toFixed(3)})`; ctx.lineWidth = envelope[Math.min(i, envelope.length - 1)] * 2; ctx.stroke()
    }
    for (const alt of alternatives) {
      ctx.beginPath(); alt.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.strokeStyle = `rgba(111,102,163,${(0.35 * alt.probability).toFixed(3)})`; ctx.lineWidth = 1 * px; ctx.setLineDash([2 * px, 4 * px]); ctx.stroke(); ctx.setLineDash([])
    }
    ctx.beginPath(); path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.strokeStyle = this.c.predicted; ctx.lineWidth = 1.4 * px; ctx.setLineDash([5 * px, 5 * px]); ctx.lineDashOffset = -(s.wallClock / 60) * px; ctx.stroke(); ctx.setLineDash([])
    const end = path[path.length - 1]
    this.label(ctx, `+${path.length - 1}s · ${Math.round(confidence * 100)}%`, { x: end.x + 3 * px, y: end.y }, px, this.c.predicted)
  }

  private drawFlow(ctx: CanvasRenderingContext2D, s: WorldState, px: number, inView: (p: WorldPoint, pad?: number) => boolean): void {
    const g = s.world.graph
    for (const f of s.intel.flow!.edges.values()) {
      const e = g.edge(f.edgeId); const ep = e && g.endpoints(e); if (!e || !ep || !inView(ep.a, 50)) continue
      const c = f.congestion
      ctx.beginPath(); ctx.moveTo(ep.a.x, ep.a.y); ctx.lineTo(ep.b.x, ep.b.y)
      // observed flow is solid; simulation-derived flow is lighter and dashed so the two never read the same
      const alpha = f.observed ? 1 : 0.55
      ctx.strokeStyle = trafficColour(c)
      ctx.globalAlpha = alpha
      ctx.lineWidth = (f.observed ? 3.5 + c * 3 : 2 + f.count * 0.6) * px
      if (!f.observed) ctx.setLineDash([5 * px, 4 * px])
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    }
  }

  private drawForecast(ctx: CanvasRenderingContext2D, s: WorldState, px: number, inView: (p: WorldPoint, pad?: number) => boolean): void {
    const g = s.world.graph, f = s.intel.forecast!
    const idx = f.horizonsMin.length - 1
    for (const [edgeId, vals] of f.edges) {
      const v = vals[idx]; if (v < 0.3) continue
      const e = g.edge(edgeId); const ep = e && g.endpoints(e); if (!e || !ep || !inView(ep.a, 50)) continue
      ctx.beginPath(); ctx.moveTo(ep.a.x, ep.a.y); ctx.lineTo(ep.b.x, ep.b.y)
      ctx.strokeStyle = trafficColour(v); ctx.globalAlpha = 0.45 + v * 0.3; ctx.lineWidth = (3 + v * 6) * px; ctx.setLineDash([6 * px, 4 * px]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.font = `${12 * this.dpr}px Georgia, serif`; ctx.fillStyle = this.c.predicted
    ctx.fillText(`FORECAST +${f.horizonsMin[idx]} min · confidence ${Math.round(f.confidence[idx] * 100)}%`, 16 * this.dpr, this.canvas.height - 56 * this.dpr)
    const cam = s.camera, k = cam.scale
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * (cam.width / 2 - cam.centre.x * k), this.dpr * (cam.height / 2 - cam.centre.y * k))
  }

  private drawRisk(ctx: CanvasRenderingContext2D, s: WorldState, px: number, inView: (p: WorldPoint, pad?: number) => boolean, upm: number): void {
    // Risk epicentres: a soft filled disc sized by risk, a firm ring, a slow pulse and the score, so the
    // worst spots read at a glance even from the neighbourhood level.
    const phase = (s.wallClock / 3000) % 1
    for (const h of s.intel.risk!.hotspots) {
      if (!inView(h, 120)) continue
      const r = (18 + 70 * h.risk) * upm
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fillStyle = this.c.risk; ctx.globalAlpha = 0.08 + 0.2 * h.risk; ctx.fill(); ctx.globalAlpha = 1
      ctx.beginPath(); ctx.arc(h.x, h.y, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = this.c.risk; ctx.globalAlpha = 0.12 + 0.2 * h.risk; ctx.fill(); ctx.globalAlpha = 1
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.strokeStyle = this.c.risk; ctx.globalAlpha = 0.35 + 0.5 * h.risk; ctx.lineWidth = 1.5 * px; ctx.stroke(); ctx.globalAlpha = 1
      ctx.beginPath(); ctx.arc(h.x, h.y, r * (1 + phase * 0.6), 0, Math.PI * 2); ctx.strokeStyle = this.c.risk; ctx.globalAlpha = 0.5 * h.risk * (1 - phase); ctx.lineWidth = 1.5 * px; ctx.stroke(); ctx.globalAlpha = 1
      const core = Math.max(4 * px, 3 * upm)
      ctx.beginPath(); ctx.arc(h.x, h.y, core, 0, Math.PI * 2); ctx.fillStyle = this.c.risk; ctx.fill(); ctx.strokeStyle = this.c.paper; ctx.lineWidth = 1.5 * px; ctx.stroke()
      if (s.lod !== 'city' && h.risk >= 0.35) this.pill(ctx, `${Math.round(h.risk * 100)}% risk`, { x: h.x + core + 4 * px, y: h.y }, px, this.c.risk, this.c.paper)
    }
  }

  private drawDensity(ctx: CanvasRenderingContext2D, s: WorldState, inView: (p: WorldPoint, pad?: number) => boolean): void {
    const d = s.intel.density!
    for (const c of d.cells.values()) {
      if (!inView(c, d.cellSize)) continue
      const v = Math.min(1, c.density / Math.max(4, d.max * 0.8))
      // two soft discs approximate a radial falloff far more cheaply than a gradient per cell
      ctx.fillStyle = `rgba(201,138,46,${(0.12 * v).toFixed(3)})`
      ctx.beginPath(); ctx.arc(c.x, c.y, d.cellSize * 0.9, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(c.x, c.y, d.cellSize * 0.5, 0, Math.PI * 2); ctx.fill()
    }
  }

  private drawActivity(ctx: CanvasRenderingContext2D, s: WorldState, inView: (p: WorldPoint, pad?: number) => boolean, px: number): void {
    const a = s.intel.activity!
    for (const h of a.hotspots) {
      if (!inView(h, 60)) continue
      const f = ((s.wallClock / 4000) + h.x * 0.001) % 1
      ctx.beginPath(); ctx.arc(h.x, h.y, (10 + f * 50) * s.world.unitPerMetre, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(201,138,46,${(0.5 * (1 - f) * h.score).toFixed(3)})`; ctx.lineWidth = 1.5 * px; ctx.stroke()
    }
  }

  private drawDrawing(ctx: CanvasRenderingContext2D, s: WorldState, px: number): void {
    const d = s.drawing!
    const pts = d.cursor ? [...d.points, d.cursor] : d.points
    if (!pts.length) return
    ctx.strokeStyle = this.c.selection; ctx.fillStyle = this.c.selection; ctx.lineWidth = 1.5 * px; ctx.setLineDash([4 * px, 4 * px])
    if (d.kind === 'radius' && pts.length >= 2) { const r = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y); ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); ctx.stroke() }
    else { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (d.kind === 'polygon' && pts.length > 2) ctx.closePath(); ctx.stroke() }
    if (d.kind === 'corridor') { ctx.lineWidth = d.width; ctx.strokeStyle = 'rgba(29,111,165,0.15)'; ctx.setLineDash([]); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke() }
    ctx.setLineDash([])
    for (const p of d.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2); ctx.fill() }
  }

  private drawSelection(ctx: CanvasRenderingContext2D, s: WorldState, sel: { kind: 'agent'; id: number } | { kind: 'entity'; id: string }, colour: string, px: number, ex: number): void {
    if (sel.kind === 'agent') {
      const a = s.world.agents.get(sel.id); if (!a) return
      const x = a.x + Math.cos(a.heading) * a.speed * ex, y = a.y + Math.sin(a.heading) * a.speed * ex
      ctx.beginPath(); ctx.arc(x, y, 6 * s.world.unitPerMetre, 0, Math.PI * 2); ctx.strokeStyle = colour; ctx.lineWidth = 1.5 * px; ctx.stroke()
    } else this.outlineEntity(ctx, s, sel.id, colour, px)
  }

  private outlineEntity(ctx: CanvasRenderingContext2D, s: WorldState, id: string, colour: string, px: number): void {
    const ie = s.world.entities.get(id); if (!ie) return
    const g = ie.entity.geometry.type
    ctx.strokeStyle = colour; ctx.lineWidth = 2 * px
    if (g === 'Point') { const p = ie.local[0]; ctx.beginPath(); ctx.arc(p.x, p.y, 8 * px, 0, Math.PI * 2); ctx.stroke(); return }
    ctx.beginPath(); ie.local.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    if (g === 'Polygon' || g === 'MultiPolygon') ctx.closePath()
    ctx.stroke()
  }

  private label(ctx: CanvasRenderingContext2D, text: string, at: WorldPoint, px: number, colour: string): void {
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(px, px)
    ctx.font = '10px Georgia, serif'; ctx.fillStyle = colour; ctx.textBaseline = 'middle'
    ctx.fillText(text, 4, 0)
    ctx.restore()
  }

  /** A small rounded label with a solid background, readable on any map. */
  private pill(ctx: CanvasRenderingContext2D, text: string, at: WorldPoint, px: number, bg: string, fg: string): void {
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(px, px)
    ctx.font = "600 11px 'DM Sans', 'Helvetica Neue', Arial, sans-serif"; ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + 12, h = 18
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, -h / 2, w, h, 9); ctx.fill()
    ctx.fillStyle = fg; ctx.fillText(text, 6, 0.5)
    ctx.restore()
  }

  dispose(): void { this.canvas.remove() }
}

function sameSel(a: { kind: string; id: string | number }, b: { kind: string; id: string | number }): boolean { return a.kind === b.kind && a.id === b.id }
