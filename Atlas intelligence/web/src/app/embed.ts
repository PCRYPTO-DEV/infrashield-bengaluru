import type { CityAtlas, Theme, ToolName } from './CityAtlas'
import type { ViewMode } from '../rendering/layers/modes'
import type { Language } from '../intelligence/reasoning/claudeExplainer'
import { lngLatToLocal, localToLngLat } from '../geo/projection/frame'
import { tr, type StringKey } from '../ui/i18n'

/**
 * The embed interface: how another app (the CityAtlas / Atlas Vision app,
 * or any page) drives Atlas Infinity inside an iframe.
 *
 * URL parameters set the first view:
 *   ?lng=77.2167&lat=28.6315&zoom=16.5&mode=mobility&lang=hi&theme=day&tool=camera&embed=1
 * `tool=camera` opens Atlas Vision (the camera panel) straight away; `place=<state id>` starts in that state.
 * `embed=1` hides the wordmark and region switcher so the host owns the chrome.
 *
 * Messages from the parent (window.postMessage, any origin the host allows):
 *   { type: 'atlas:setView', lng, lat, zoom? }
 *   { type: 'atlas:setMode', mode }               reality | mobility | activity | risk | forecast | ink3d
 *   { type: 'atlas:setLanguage', lang }           en | hi
 *   { type: 'atlas:setTheme', theme }             night | day
 *   { type: 'atlas:openTool', tool }              layers | zones | route | upload | pulse | camera | alerts | insights | null
 *   { type: 'atlas:ask', question }               answered by Ask the City; reply below
 *   { type: 'atlas:zone', name, ring: [{lng,lat}] } draws a watch zone
 *   { type: 'atlas:snapshot' }                    replies with the fact snapshot
 *
 * Messages to the parent:
 *   { type: 'atlas:ready', region, seed }
 *   { type: 'atlas:answer', question, text, classification, writer, facts }
 *   { type: 'atlas:selection', kind, id, lng, lat }
 *   { type: 'atlas:zoneEvent', zone, kind, description, time }
 *   { type: 'atlas:snapshot', facts }
 *   { type: 'atlas:camera', status, people, vehicles, detector }   while Atlas Vision counts (never a frame, never a face)
 *   { type: 'atlas:insights', items: [{ id, kind, severity, text, classification, source, lng, lat }] }  when the ranked findings change
 *   { type: 'atlas:view', lng, lat, zoom }        on every camera change (throttled)
 */
export interface EmbedOptions { allowedOrigins?: string[] }

const TOOLS: ToolName[] = ['layers', 'zones', 'route', 'upload', 'pulse', 'camera', 'alerts', 'insights', 'sites', 'scenario', 'saved', 'report']
export function readEmbedParams(search: string): { lng?: number; lat?: number; zoom?: number; mode?: ViewMode; lang?: Language; theme?: Theme; tool?: ToolName; embed: boolean } {
  const q = new URLSearchParams(search)
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined)
  const mode = q.get('mode') as ViewMode | null
  const lang = q.get('lang') as Language | null
  const theme = q.get('theme')
  const tool = q.get('tool') as ToolName | null
  return { tool: tool && TOOLS.includes(tool) ? tool : undefined, theme: theme === 'day' || theme === 'night' ? theme : undefined, lng: num('lng'), lat: num('lat'), zoom: num('zoom'), mode: mode && ['reality', 'mobility', 'activity', 'risk', 'forecast', 'ink3d'].includes(mode) ? mode : undefined, lang: lang === 'hi' || lang === 'en' ? lang : undefined, embed: q.get('embed') === '1' }
}

export function installEmbed(app: CityAtlas, opts: EmbedOptions = {}): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => {}
  const allowed = opts.allowedOrigins
  const send = (msg: Record<string, unknown>) => { try { window.parent.postMessage(msg, '*') } catch { /* host gone */ } }
  const okOrigin = (o: string) => !allowed || allowed.includes(o)

  const onMessage = async (e: MessageEvent) => {
    if (!okOrigin(e.origin)) return
    const m = e.data as { type?: string } & Record<string, unknown>
    if (!m || typeof m.type !== 'string' || !m.type.startsWith('atlas:')) return
    switch (m.type) {
      case 'atlas:setView': {
        const lng = Number(m.lng), lat = Number(m.lat)
        if (Number.isFinite(lng) && Number.isFinite(lat)) app.camera.setView(lngLatToLocal(app.frame, { lng, lat }), typeof m.zoom === 'number' ? m.zoom : undefined)
        break
      }
      case 'atlas:setMode': if (typeof m.mode === 'string') app.setMode(m.mode as ViewMode); break
      case 'atlas:setLanguage': if (m.lang === 'en' || m.lang === 'hi') app.setLanguage(m.lang); break
      case 'atlas:setTheme': if (m.theme === 'day' || m.theme === 'night') app.setTheme(m.theme); break
      case 'atlas:openTool': app.requestTool(m.tool === null ? null : TOOLS.includes(m.tool as ToolName) ? (m.tool as ToolName) : null); break
      case 'atlas:ask': {
        if (typeof m.question !== 'string') break
        const a = await app.ask(m.question)
        send({ type: 'atlas:answer', question: a.question, text: a.summary, classification: a.classification, writer: a.writer ?? 'template', facts: a.evidence.map((f) => ({ classification: f.classification, statement: f.statement, source: f.source })) })
        break
      }
      case 'atlas:zone': {
        const ring = Array.isArray(m.ring) ? (m.ring as Array<{ lng: number; lat: number }>).map((p) => lngLatToLocal(app.frame, p)) : []
        if (ring.length >= 3) app.zones.create(String(m.name ?? `Zone ${app.zones.zones.size + 1}`), { kind: 'polygon', points: ring }, [{ type: 'entry' }, { type: 'exit' }, { type: 'count', threshold: 25 }], false, app.temporal.current.timestamp)
        break
      }
      case 'atlas:snapshot': send({ type: 'atlas:snapshot', facts: app.worldSnapshot() }); break
    }
  }
  window.addEventListener('message', onMessage)

  let lastView = 0, lastSel = '', lastEvent = '', lastCam = '', lastIns = ''
  const unsub = app.subscribe(() => {
    const v = app.vision
    const cam = `${v.status}:${v.stats.people}:${v.stats.vehicles}`
    if (cam !== lastCam) { lastCam = cam; send({ type: 'atlas:camera', status: v.status, people: v.stats.people, vehicles: v.stats.vehicles, detector: v.detectorId }) }
    const ins = app.insights.map((i) => i.id).join('|')
    if (ins !== lastIns) { lastIns = ins; send({ type: 'atlas:insights', items: app.insights.map((i) => { const ll = i.point ? localToLngLat(app.frame, i.point) : null; return { id: i.id, kind: i.kind, severity: i.severity, text: tr(app.language, i.key as StringKey, i.vars), classification: i.classification, source: i.source, lng: ll?.lng, lat: ll?.lat } }) }) }
    const now = Date.now()
    if (now - lastView > 500) { lastView = now; const c = localToLngLat(app.frame, app.camera.centre); send({ type: 'atlas:view', lng: c.lng, lat: c.lat, zoom: app.camera.zoom }) }
    const sel = app.selection ? `${app.selection.kind}:${app.selection.id}` : ''
    if (sel !== lastSel) {
      lastSel = sel
      if (app.selection) {
        const p = app.selection.kind === 'agent' ? app.world.agents.get(app.selection.id) : (() => { const ie = app.world.entities.get(app.selection.id); return ie ? { x: (ie.bounds.minX + ie.bounds.maxX) / 2, y: (ie.bounds.minY + ie.bounds.maxY) / 2 } : null })()
        const ll = p ? localToLngLat(app.frame, p) : null
        send({ type: 'atlas:selection', kind: app.selection.kind, id: app.selection.id, lng: ll?.lng, lat: ll?.lat })
      }
    }
    const ev = app.zoneEvents[app.zoneEvents.length - 1]
    if (ev && ev.id !== lastEvent) { lastEvent = ev.id; send({ type: 'atlas:zoneEvent', zone: app.zones.zones.get(ev.zoneId)?.name, kind: ev.type, description: ev.description, time: ev.timestamp }) }
  })
  send({ type: 'atlas:ready', region: app.region.id, seed: app.seed })
  return () => { window.removeEventListener('message', onMessage); unsub() }
}
