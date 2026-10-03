import { useEffect, useMemo, useRef, useState } from 'react'
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
import { PlaceCard } from './panels/PlaceCard'
import { WhatChanged } from './panels/WhatChanged'
import { ComparePanel } from './panels/ComparePanel'
import { SiteFinderPanel } from './panels/SiteFinderPanel'
import { GentrificationPanel } from './panels/GentrificationPanel'
import { InvestPanel } from './panels/InvestPanel'
import { TrackRecordPanel } from './panels/TrackRecordPanel'
import { giColor } from '../data/adapters/gentrificationAdapter'
import { ScenarioPanel } from './panels/ScenarioPanel'
import { SavedPanel } from './panels/SavedPanel'
import { ReportPanel } from './panels/ReportPanel'
import { Home } from './overlays/Home'
import { AroundYou } from './overlays/AroundYou'
import { unlockAudio } from './bleep'
import { MODES } from '../rendering/layers/modes'
import { parseWorldUri } from '../engine/seed/worldSeed'
import { makeT, type StringKey } from './i18n'
import { installEmbed, readEmbedParams } from '../app/embed'
import { lngLatToLocal } from '../geo/projection/frame'
import type { PlaceState } from '../data/adapters/placeAdapter'
import { Stones } from './controls/Stones'

type Tool = 'layers' | 'zones' | 'route' | 'upload' | 'pulse' | 'camera' | 'alerts' | 'insights' | 'changed' | 'compare' | 'sites' | 'scenario' | 'saved' | 'report' | 'gentrification' | 'invest' | 'trackrecord' | null
const TOOLS = ['insights', 'layers', 'zones', 'route', 'upload', 'pulse', 'camera', 'alerts', 'compare', 'sites', 'gentrification', 'invest', 'trackrecord', 'scenario', 'saved', 'report'] as const

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

/**
 * The surface stays almost impossibly simple: the City Atlas mark, Ask Atlas, search,
 * What changed?, the time bar and the map. Everything else appears contextually under More.
 */
export default function App() {
  const [seed] = useState(seedFromUrl)
  const [regionId, setRegionId] = useState(() => regionFromSearch(window.location.search).id)
  const [placeKey, setPlaceKey] = useState(() => new URLSearchParams(window.location.search).get('place') ?? '')
  // The region from the URL carries the origin (?place= or ?lng&lat), so the whole of India is one region with a movable frame.
  const app = useMemo(() => new CityAtlas(seed, regionId === regionFromSearch(window.location.search).id ? regionFromSearch(window.location.search) : REGIONS[regionId]), [seed, regionId, placeKey])
  useAppVersion(app)
  const embed = useMemo(() => readEmbedParams(window.location.search), [])
  const [tool, setTool] = useState<Tool>(embed.tool ?? null)
  const [more, setMore] = useState(false)
  const [compare, setCompare] = useState<Array<{ name: string; state: PlaceState }>>([])
  useEffect(() => { if (app.toolRequest) { setTool(app.toolRequest); app.toolRequest = null } }, [app.toolRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const u = () => unlockAudio(); window.addEventListener('pointerdown', u, { once: true }); window.addEventListener('keydown', u, { once: true }); return () => { window.removeEventListener('pointerdown', u); window.removeEventListener('keydown', u) } }, [])
  // A far search result re-anchors the frame at that point (?lng&lat), then opens its card once the new app exists.
  const pendingRef = useRef<{ lng: number; lat: number; zoom: number; openCard: boolean } | null>(null)
  const [customCity, setCustomCity] = useState<string | null>(() => new URLSearchParams(window.location.search).get('name'))
  useEffect(() => {
    const r = app.relocateRequest; if (!r) return
    app.relocateRequest = null
    try { const url = new URL(window.location.href); url.searchParams.set('lng', r.lng.toFixed(5)); url.searchParams.set('lat', r.lat.toFixed(5)); url.searchParams.set('name', r.name); url.searchParams.delete('place'); url.searchParams.delete('world'); window.history.replaceState({}, '', url) } catch { /* sandboxed host */ }
    pendingRef.current = { lng: r.lng, lat: r.lat, zoom: r.zoom, openCard: r.openCard }
    setCustomCity(r.name); app.dispose(); setRegionId('india'); setPlaceKey(`ll:${r.lng.toFixed(4)},${r.lat.toFixed(4)}`)
  }, [app.relocateRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = pendingRef.current; if (!p) return
    pendingRef.current = null
    app.flyToLngLat(p.lng, p.lat, p.zoom, false)
    if (p.openCard) void app.openPlaceAt(p.lng, p.lat)
  }, [app])
  const goPlace = (id: string) => {
    setCustomCity(null)
    const c = PLACES.find((x) => x.id === id); if (!c) return
    try { const url = new URL(window.location.href); url.searchParams.set('place', id); url.searchParams.delete('lng'); url.searchParams.delete('lat'); url.searchParams.delete('name'); url.searchParams.delete('world'); window.history.replaceState({}, '', url) } catch { /* sandboxed host */ }
    app.dispose(); setRegionId('india'); setPlaceKey(id)
  }
  const placeNow = placeKey.startsWith('ll:') ? '' : placeKey || 'delhi'
  const cityName = customCity && placeKey.startsWith('ll:') ? { id: '', name: customCity, hi: customCity, lng: 0, lat: 0 } : (PLACES.find((c) => c.id === placeNow) ?? PLACES[0])
  const city = app.language === 'hi' ? cityName.hi.split(' · ').pop()! : cityName.name.split(' · ').pop()!
  const toggle = (t: Tool) => { setTool((cur) => (cur === t ? null : t)); setMore(false) }
  useEffect(() => {
    if (!more) return
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.ca-tools')) setMore(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false) }
    document.addEventListener('pointerdown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [more])
  const T = makeT(app.language)
  useEffect(() => {
    if (embed.lang) app.setLanguage(embed.lang)
    if (embed.theme) app.setTheme(embed.theme)
    if (embed.lng !== undefined && embed.lat !== undefined) app.camera.setView(lngLatToLocal(app.frame, { lng: embed.lng, lat: embed.lat }), embed.zoom)
    else if (embed.zoom !== undefined) app.camera.setView(app.camera.centre, embed.zoom)
    return installEmbed(app)
  }, [app, embed])
  const addCompare = (name: string, st: PlaceState) => { setCompare((c) => (c.some((x) => x.state.cell === st.cell) || c.length >= 3 ? c : [...c, { name, state: st }])); setTool('compare') }
  const sidePanel = tool === 'zones' || tool === 'route' || tool === 'upload' || tool === 'pulse' || tool === 'sites' || tool === 'gentrification' || tool === 'invest' || tool === 'trackrecord' || tool === 'scenario' || tool === 'saved' || tool === 'report'
  const cardOverList = (tool === 'sites' || tool === 'saved' || tool === 'gentrification' || tool === 'invest') && !!app.placePoint
  return (
    <div className={`ca-app ${app.theme}${embed.embed ? ' ca-embed' : ''}`}>
      <CityView key={`${regionId}:${seed}:${placeKey}`} app={app} />

      {/* 1. the mark, with language and theme */}
      <div className="ca-top">
        <div className="ca-brand"><img src="./brand/symbol-64.png" alt="City Atlas" width={34} height={34} /><div><h1 className="ca-wordmark">CITY ATLAS</h1><span className="ca-by">{app.tier === 'pro' ? 'PRO · ' : app.tier === 'plus' ? 'PLUS · ' : ''}{T('top.tagline')} · {city}</span></div>
          <span className="ca-lang" title="Language · भाषा"><button className={app.language === 'en' ? 'active' : ''} onClick={() => app.setLanguage('en')}>EN</button><button className={app.language === 'hi' ? 'active' : ''} onClick={() => app.setLanguage('hi')}>हि</button></span>
          <span className="ca-lang ca-theme" title={T('theme.title')}><button className={app.theme === 'night' ? 'active' : ''} onClick={() => app.setTheme('night')} aria-label={T('theme.night')}>☾</button><button className={app.theme === 'day' ? 'active' : ''} onClick={() => app.setTheme('day')} aria-label={T('theme.day')}>☀</button></span>
        </div>
      </div>

      {/* the five stones: LOOK · GO · SAFE · CHANGE · WORTH, always one tap away */}
      {!embed.embed && <Stones app={app} variant="dock" active={tool === 'route' ? 'go' : tool === 'report' ? 'safe' : tool === 'gentrification' || tool === 'changed' ? 'change' : tool === 'invest' ? 'worth' : app.placePoint ? 'look' : null} />}

      {!embed.embed && <AroundYou app={app} onOpen={() => { app.select(null); setTool((t) => (t === 'changed' ? t : null)) }} />}

      {/* 2. search, what changed, more */}
      <div className="ca-tools">
        <div className="ca-toolrow ca-primary">
          <SearchBox app={app} />
          <select className="ca-place-select" title={T('place.goto')} value={placeNow} onChange={(e) => goPlace(e.target.value)}>{placeKey.startsWith('ll:') && <option value="">{cityName.name}</option>}{PLACES.map((c) => <option key={c.id} value={c.id}>{app.language === 'hi' ? c.hi : c.name}</option>)}</select>
          <button className={`ca-tool ca-changed-btn ${tool === 'changed' ? 'active' : ''}`} onClick={() => toggle('changed')}>{T('changed.btn')}{app.changes && app.changes.count > 0 && <b>{app.changes.count}</b>}</button>
          <button className={`ca-tool ca-report-btn ${tool === 'report' ? 'active' : ''}`} onClick={() => { toggle('report'); app.select(null) }} title={T('rep.title')}>{T('rep.btn')}{app.reports.length > 0 && <b>{app.reports.length}</b>}</button>
          <button className={`ca-tool ${more ? 'active' : ''}`} onClick={() => setMore(!more)}>{T('more')} {more ? '▴' : '▾'}</button>
        </div>
        {more && <div className="ca-more" role="menu">
          <button className="ca-more-close" aria-label="close" onClick={() => setMore(false)}>×</button>
          <div className="ca-more-group"><span>{T('more.modes')}</span><div className="ca-toolrow">{MODES.map((m) => <button key={m.id} className={`ca-tool ${app.mode === m.id ? 'active' : ''}`} title={T(`mode.${m.id}.b` as StringKey)} onClick={() => { app.setMode(m.id); setMore(false) }}>{T(`mode.${m.id}` as StringKey)}</button>)}</div></div>
          <div className="ca-more-group"><span>{T('more.tools')}</span><div className="ca-toolrow">{TOOLS.map((t) => <button key={t} className={`ca-tool ${tool === t ? 'active' : ''}`} onClick={() => { toggle(t); app.select(null) }}>{T(`tool.${t}` as StringKey)}</button>)}</div></div>
          {app.mode === 'ink3d' && <div className="ca-more-group"><span>{T('mode.ink3d')}</span><div className="ca-toolrow"><span className="note">{app.camera.zoom < 16 ? T('ink.zoom') : app.inkPending > 0 ? T('ink.drawing', { n: app.inkPending }) : T('ink.ready')}</span><button className="ca-tool" onClick={() => saveDrawing(app)}>{T('ink.save')}</button></div></div>}
          <div className="ca-more-group"><span>{T('more.about')}</span><div className="ca-badges">{app.region.source === 'osm' ? <span className="ca-badge observed">{T('badge.osm')}</span> : <span className="ca-badge simulated">{T('badge.demo')}</span>} {app.liveStatus.live ? <span className="ca-badge observed">{T('badge.livetraffic')}</span> : <span className="ca-badge derived">{T('badge.notraffic')}</span>} <span className="ca-badge observed">{T('badge.realonly')}</span>{app.realDataFallbacks > 0 && <span className="ca-badge derived">{T('badge.fallback', { n: app.realDataFallbacks })}</span>}</div></div>
          <div className="ca-more-group"><span>{app.tier === 'pro' ? T('tier.pro') : T('tier.plus')}</span><div className="ca-toolrow">{app.tier === 'free' ? <><span className="note">{T('tier.locked')}</span><button className="ca-tool" onClick={() => { toggle('sites') }}>{T('tier.pro.try')}</button></> : <><span className="note">{T(app.tier === 'pro' ? 'tier.open.pro' : 'tier.open')}</span>{app.tier === 'plus' && <button className="ca-tool" onClick={() => { toggle('sites') }}>{T('tier.pro.try')}</button>}<button className="ca-tool" onClick={() => app.lock()}>{T('tier.leave')}</button></>}</div></div>
        </div>}
        {tool === 'layers' && <LayersPanel app={app} />}
      </div>

      {/* 3. contextual panels */}
      {tool === 'zones' && !app.selection && <ZonesPanel app={app} />}
      {tool === 'route' && !app.selection && <RoutePanel app={app} />}
      {tool === 'upload' && !app.selection && <UploadPanel app={app} />}
      {tool === 'pulse' && !app.selection && <PulsePanel app={app} />}
      {/* list panels stay mounted (their results survive) while a place card opened from them is on top */}
      {tool === 'sites' && !app.selection && <div className="ca-keep" hidden={cardOverList}><SiteFinderPanel app={app} /></div>}
      {tool === 'gentrification' && !app.selection && <div className="ca-keep" hidden={cardOverList}><GentrificationPanel app={app} /></div>}
      {tool === 'invest' && !app.selection && <div className="ca-keep" hidden={cardOverList}><InvestPanel app={app} /></div>}
      {tool === 'trackrecord' && !app.selection && <TrackRecordPanel app={app} />}
      {tool === 'scenario' && !app.selection && <ScenarioPanel app={app} />}
      {tool === 'report' && !app.selection && <ReportPanel app={app} />}
      {tool === 'saved' && !app.selection && <div className="ca-keep" hidden={cardOverList}><SavedPanel app={app} /></div>}
      {tool === 'camera' && <VisionPanel app={app} />}
      {tool === 'alerts' && <AlertsPanel app={app} />}
      {tool === 'insights' && <InsightsPanel app={app} />}
      {tool === 'changed' && <WhatChanged app={app} />}
      {tool === 'compare' && <ComparePanel app={app} places={compare} onRemove={(i) => setCompare((c) => c.filter((_, j) => j !== i))} />}
      {(!sidePanel || cardOverList) && tool !== 'changed' && tool !== 'compare' && !app.selection && <PlaceCard app={app} onCompare={addCompare} />}
      <InspectorPanel app={app} />
      <InsightBubbles app={app} onOpen={() => setTool('insights')} onReport={() => setTool('report')} />
      {app.gentriHover && !app.reportHover && (() => { const h = app.gentriHover.cell; return (
        <div className="ca-gen-tip" style={{ left: Math.min(app.gentriHover.x + 14, window.innerWidth - 240), top: Math.max(8, app.gentriHover.y - 12) }}>
          <b style={{ color: giColor(h.cls as never) }}>{h.cls ? T(`gen.class.${h.cls}` as StringKey) : T('gen.nodata')}</b>
          <small>{T('gen.tip', { g: h.gi ?? '–', c: T('gen.gicomp.amenityPremium'), n: h.places })}</small>
        </div>) })()}
      {app.reportHover && (() => { const r = app.reportHover.report; const when = r.ageMin < 60 ? T('rep.min', { n: r.ageMin }) : T('rep.hr', { n: Math.round(r.ageMin / 60) }); return (
        <div className="ca-skull-tip" style={{ left: Math.min(app.reportHover.x + 14, window.innerWidth - 300), top: Math.max(8, app.reportHover.y - 12) }} lang={app.language === 'hi' ? 'hi' : 'en'}>
          <b>☠ {T(`rep.k.${r.kind}` as StringKey)}</b> <span>{when}</span>
          {r.description && <p>{r.description}</p>}
          <small>{r.source === 'news' ? `${T('rep.news.meta')}${r.publisher ? ` · ${r.publisher}` : ''}${r.precisionM ? ` · ±${Math.round(r.precisionM)} m` : ''}` : T('rep.meta')}</small>
          {r.url && <small className="ca-skull-link">{T('rep.news.open')}</small>}
        </div>
      ) })()}

      {/* 4. Ask Atlas, 5. legend pill, 6. time bar */}
      <AskPanel app={app} />
      <Legend app={app} />
      <Timeline app={app} />
      {app.region.source === 'osm' && app.stats.chunks === 0 && (app.stats.inFlight > 0 || app.realDataError) && !app.pointPick && !app.draw.active && (
        app.stats.inFlight > 0 && !app.realDataError
          ? <div className="ca-hint ca-loading">{T('load.streets', { n: app.stats.inFlight })}</div>
          : <div className="ca-hint ca-failed">{T('load.failed', { why: app.realDataError ?? '' })} · <button className="small" onClick={() => window.location.reload()}>{T('load.retry')}</button></div>
      )}
      {app.pointPick && <div className="ca-hint">{app.pointPick.label} · <button className="small" onClick={() => app.cancelPick()}>{T('hint.cancel')}</button></div>}
      {app.draw.active && !app.pointPick && <div className="ca-hint">{app.draw.state?.kind === 'route' ? T('hint.route') : T('hint.draw', { k: T(`zone.${app.draw.state?.kind}` as StringKey) })}</div>}
      {!embed.embed && <Home app={app} city={city} onChanged={() => setTool('changed')} onAsk={() => document.querySelector<HTMLInputElement>('.ca-ask input')?.focus()} />}
    </div>
  )
}
