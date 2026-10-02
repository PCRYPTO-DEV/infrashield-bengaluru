import { useMemo, useState } from 'react'
import { CityAtlas } from '../app/CityAtlas'
import { REGIONS, PLACES, regionFromSearch } from '../app/regions'
import { useAppVersion } from './useApp'
import { CityView } from './CityView'
import { Timeline } from './controls/Timeline'
import { InspectorPanel } from './panels/InspectorPanel'
import { AskPanel } from './panels/AskPanel'
import { LayersPanel, PulsePanel, ZonesPanel, RoutePanel, UploadPanel, SearchBox } from './panels/SidePanels'
import { Legend } from './overlays/Legend'
import { VisionPanel } from './panels/VisionPanel'
import { AlertsPanel } from './panels/AlertsPanel'
import { InsightsPanel } from './panels/InsightsPanel'
import { InsightBubbles } from './overlays/InsightBubbles'
import { unlockAudio } from './bleep'
import { MODES } from '../rendering/layers/modes'
import { formatWorldUri, parseWorldUri } from '../engine/seed/worldSeed'
import { makeT, type StringKey } from './i18n'
import { installEmbed, readEmbedParams } from '../app/embed'
import { lngLatToLocal } from '../geo/projection/frame'
import { useEffect } from 'react'
import { WelcomeCard } from './overlays/WelcomeCard'

type Tool = 'layers' | 'zones' | 'route' | 'upload' | 'pulse' | 'camera' | 'alerts' | 'insights' | null

function seedFromUrl(): string {
  const p = new URLSearchParams(window.location.search)
  const w = p.get('world') ?? p.get('seed')
  return (w && parseWorldUri(w)?.seed) || regionFromSearch(window.location.search).seed
}

function saveDrawing(app: { exportDrawing(): { svg: string; filename: string } }): void {
  const { svg, filename } = app.exportDrawing()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function App() {
  const [seed, setSeed] = useState(seedFromUrl)
  const [regionId, setRegionId] = useState(() => regionFromSearch(window.location.search).id)
  const [placeKey, setPlaceKey] = useState(() => new URLSearchParams(window.location.search).get('place') ?? '')
  // The region from the URL carries the origin (?place= or ?lng&lat), so the whole of India is one region with a movable frame.
  const app = useMemo(() => new CityAtlas(seed, regionId === regionFromSearch(window.location.search).id ? regionFromSearch(window.location.search) : REGIONS[regionId]), [seed, regionId, placeKey])
  useAppVersion(app)
  const embedParams = useMemo(() => readEmbedParams(window.location.search), [])
  const [tool, setTool] = useState<Tool>(embedParams.tool ?? null)
  // A panel asked for by the host page (embed) or another part of the app.
  useEffect(() => { if (app.toolRequest !== null || tool !== null) { if (app.toolRequest !== undefined && app.toolRequest !== null) { setTool(app.toolRequest); app.toolRequest = null } } }, [app.toolRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const u = () => unlockAudio(); window.addEventListener('pointerdown', u, { once: true }); window.addEventListener('keydown', u, { once: true }); return () => { window.removeEventListener('pointerdown', u); window.removeEventListener('keydown', u) } }, [])
  const goPlace = (id: string) => {
    const c = PLACES.find((x) => x.id === id); if (!c) return
    try { const url = new URL(window.location.href); url.searchParams.set('place', id); url.searchParams.delete('lng'); url.searchParams.delete('lat'); url.searchParams.delete('world'); window.history.replaceState({}, '', url) } catch { /* sandboxed host */ }
    app.dispose(); setRegionId('india'); setPlaceKey(id)
  }
  const placeNow = placeKey || 'delhi'
  const [seedInput, setSeedInput] = useState(seed)
  const regenerate = () => {
    const s = parseWorldUri(seedInput)?.seed ?? seed
    try { const url = new URL(window.location.href); url.searchParams.set('world', formatWorldUri(s)); window.history.replaceState({}, '', url) } catch { /* sandboxed host: keep the seed in page state only */ }
    app.dispose(); setSeed(s)
  }
  const district = [...app.world.chunks.values()][0]?.meta.districtName
  const switchRegion = (id: string) => {
    try { const url = new URL(window.location.href); url.searchParams.set('region', id); url.searchParams.delete('world'); window.history.replaceState({}, '', url) } catch { /* sandboxed host */ }
    app.dispose(); setRegionId(id); setSeed(REGIONS[id].seed); setSeedInput(REGIONS[id].seed)
  }
  const toggle = (t: Tool) => setTool((cur) => (cur === t ? null : t))
  const T = makeT(app.language)
  const embed = embedParams
  // The made-up demo city is an engineering demo, shown in the switcher only when asked for (?demo=1).
  const showDemo = useMemo(() => new URLSearchParams(window.location.search).get('demo') === '1', [])
  useEffect(() => {
    if (embed.lang) app.setLanguage(embed.lang)
    if (embed.theme) app.setTheme(embed.theme)
    if (embed.mode) app.setMode(embed.mode)
    if (embed.lng !== undefined && embed.lat !== undefined) app.camera.setView(lngLatToLocal(app.frame, { lng: embed.lng, lat: embed.lat }), embed.zoom)
    else if (embed.zoom !== undefined) app.camera.setView(app.camera.centre, embed.zoom)
    return installEmbed(app)
  }, [app, embed])
  return (
    <div className={`ca-app ${app.theme}${embed.embed ? ' ca-embed' : ''}`}>
      <CityView key={`${regionId}:${seed}:${placeKey}`} app={app} />
      <div className="ca-top">
        <div className="ca-brand"><img src="./brand/symbol-64.png" alt="City Atlas" width={34} height={34} /><div><h1 className="ca-wordmark">ATLAS INFINITY</h1><span className="ca-by">CITY ATLAS · people · places · possibilities</span></div></div>
        <p className="ca-tagline">{T('top.tagline')} · {app.region.name}{district && district !== app.region.name ? ` · ${district}` : ''}</p>
        <div className="ca-regions">{Object.values(REGIONS).filter((r) => !r.demo || showDemo || r.id === regionId).map((r) => <button key={r.id} className={r.id === regionId ? 'active' : ''} onClick={() => switchRegion(r.id)}>{r.name}</button>)}
          <select className="ca-place-select" title={T('place.title')} value={placeNow} onChange={(e) => goPlace(e.target.value)}>{PLACES.map((c) => <option key={c.id} value={c.id}>{app.language === 'hi' ? c.hi : c.name}</option>)}</select>
          <span className="ca-lang" title="Language · भाषा"><button className={app.language === 'en' ? 'active' : ''} onClick={() => app.setLanguage('en')}>English</button><button className={app.language === 'hi' ? 'active' : ''} onClick={() => app.setLanguage('hi')}>हिंदी</button></span>
          <span className="ca-lang ca-theme" title={T('theme.title')}><button className={app.theme === 'night' ? 'active' : ''} onClick={() => app.setTheme('night')} aria-label={T('theme.night')}>☾ {T('theme.night')}</button><button className={app.theme === 'day' ? 'active' : ''} onClick={() => app.setTheme('day')} aria-label={T('theme.day')}>☀ {T('theme.day')}</button></span></div>
        <div className="ca-seed">
          <span>atlas://world/</span>
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && regenerate()} />
          <button onClick={regenerate}>{T('top.regenerate')}</button>
        </div>
        <div>{app.region.source === 'osm' ? <span className="ca-badge observed">{T('badge.osm')}</span> : <span className="ca-badge simulated">{T('badge.demo')}</span>} {app.liveStatus.live ? <span className="ca-badge observed" style={{ marginLeft: 4 }}>{T('badge.livetraffic')}</span> : app.region.simulation ? <span className="ca-badge simulated" style={{ marginLeft: 4 }}>{T('badge.simtraffic')}</span> : <span className="ca-badge derived" style={{ marginLeft: 4 }}>{T('badge.notraffic')}</span>} {!app.region.simulation && <span className="ca-badge observed" style={{ marginLeft: 4 }}>{T('badge.realonly')}</span>}{app.realDataFallbacks > 0 && <span className="ca-badge derived" style={{ marginLeft: 4 }}>{T('badge.fallback', { n: app.realDataFallbacks })}</span>}</div>
      </div>
      <div className="ca-modes">{MODES.map((m) => <button key={m.id} className={app.mode === m.id ? 'active' : ''} title={T(`mode.${m.id}.b` as StringKey)} onClick={() => app.setMode(m.id)}>{T(`mode.${m.id}` as StringKey)}</button>)}</div>
      {app.mode === 'ink3d' && <div className="ca-inkbar">
        <span>{app.camera.zoom < 16 ? T('ink.zoom') : app.inkPending > 0 ? T('ink.drawing', { n: app.inkPending }) : T('ink.ready')}</span>
        <button onClick={() => saveDrawing(app)}>{T('ink.save')}</button>
      </div>}
      <div className="ca-tools">
        <SearchBox app={app} />
        <div className="ca-toolrow">
          {(['insights', 'layers', 'zones', 'route', 'upload', 'pulse', 'camera', 'alerts'] as const).map((t) => <button key={t} className={`ca-tool ${tool === t ? 'active' : ''}`} onClick={() => { toggle(t); app.select(null) }}>{T(`tool.${t}` as StringKey)}</button>)}
        </div>
        {tool === 'layers' && <LayersPanel app={app} />}
      </div>
      {tool === 'zones' && !app.selection && <ZonesPanel app={app} />}
      {tool === 'route' && !app.selection && <RoutePanel app={app} />}
      {tool === 'upload' && !app.selection && <UploadPanel app={app} />}
      {tool === 'pulse' && !app.selection && <PulsePanel app={app} />}
      {tool === 'camera' && <VisionPanel app={app} />}
      {tool === 'alerts' && <AlertsPanel app={app} />}
      {tool === 'insights' && <InsightsPanel app={app} />}
      <InsightBubbles app={app} onOpen={() => setTool('insights')} />
      <InspectorPanel app={app} />
      <AskPanel app={app} />
      <Legend app={app} />
      <Timeline app={app} />
      {!embed.embed && <WelcomeCard app={app} onAsk={() => { document.querySelector<HTMLInputElement>('.ca-ask input')?.focus() }} />}
      {app.region.source === 'osm' && app.stats.chunks === 0 && (app.stats.inFlight > 0 || app.realDataError) && !app.pointPick && !app.draw.active && (
        app.stats.inFlight > 0 && !app.realDataError
          ? <div className="ca-hint ca-loading">{T('load.streets', { n: app.stats.inFlight })}</div>
          : <div className="ca-hint ca-failed">{T('load.failed', { why: app.realDataError ?? '' })} · <button className="small" onClick={() => window.location.reload()}>{T('load.retry')}</button></div>
      )}
      {app.pointPick && <div className="ca-hint">{app.pointPick.label} · <button className="small" onClick={() => app.cancelPick()}>{T('hint.cancel')}</button></div>}
      {app.draw.active && !app.pointPick && <div className="ca-hint">{app.draw.state?.kind === 'route' ? T('hint.route') : T('hint.draw', { k: T(`zone.${app.draw.state?.kind}` as StringKey) })}</div>}
    </div>
  )
}
