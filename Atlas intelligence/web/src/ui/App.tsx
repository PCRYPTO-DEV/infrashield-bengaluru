import { useMemo, useState } from 'react'
import { CityAtlas } from '../app/CityAtlas'
import { REGIONS, regionFromSearch } from '../app/regions'
import { useAppVersion } from './useApp'
import { CityView } from './CityView'
import { Timeline } from './controls/Timeline'
import { InspectorPanel } from './panels/InspectorPanel'
import { AskPanel } from './panels/AskPanel'
import { LayersPanel, PulsePanel, ZonesPanel, RoutePanel, UploadPanel, SearchBox } from './panels/SidePanels'
import { Legend } from './overlays/Legend'
import { VisionPanel } from './panels/VisionPanel'
import { AlertsPanel } from './panels/AlertsPanel'
import { MODES } from '../rendering/layers/modes'
import { formatWorldUri, parseWorldUri } from '../engine/seed/worldSeed'
import { makeT, type StringKey } from './i18n'
import { installEmbed, readEmbedParams } from '../app/embed'
import { lngLatToLocal } from '../geo/projection/frame'
import { useEffect } from 'react'

type Tool = 'layers' | 'zones' | 'route' | 'upload' | 'pulse' | 'camera' | 'alerts' | null

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
  const app = useMemo(() => new CityAtlas(seed, REGIONS[regionId]), [seed, regionId])
  useAppVersion(app)
  const [tool, setTool] = useState<Tool>(null)
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
  const embed = useMemo(() => readEmbedParams(window.location.search), [])
  // The made-up demo city is an engineering demo, shown in the switcher only when asked for (?demo=1).
  const showDemo = useMemo(() => new URLSearchParams(window.location.search).get('demo') === '1', [])
  useEffect(() => {
    if (embed.lang) app.setLanguage(embed.lang)
    if (embed.mode) app.setMode(embed.mode)
    if (embed.lng !== undefined && embed.lat !== undefined) app.camera.setView(lngLatToLocal(app.frame, { lng: embed.lng, lat: embed.lat }), embed.zoom)
    else if (embed.zoom !== undefined) app.camera.setView(app.camera.centre, embed.zoom)
    return installEmbed(app)
  }, [app, embed])
  return (
    <div className={`ca-app${embed.embed ? ' ca-embed' : ''}`}>
      <CityView key={`${regionId}:${seed}`} app={app} />
      <div className="ca-top">
        <div className="ca-brand"><img src="./brand/symbol-64.png" alt="City Atlas" width={34} height={34} /><div><h1 className="ca-wordmark">ATLAS INFINITY</h1><span className="ca-by">CITY ATLAS · people · places · possibilities</span></div></div>
        <p className="ca-tagline">{T('top.tagline')} · {app.region.name}{district ? ` · ${district}` : ''}</p>
        <div className="ca-regions">{Object.values(REGIONS).filter((r) => !r.demo || showDemo || r.id === regionId).map((r) => <button key={r.id} className={r.id === regionId ? 'active' : ''} onClick={() => switchRegion(r.id)}>{r.name}</button>)}
          <span className="ca-lang" title="Language · भाषा"><button className={app.language === 'en' ? 'active' : ''} onClick={() => app.setLanguage('en')}>English</button><button className={app.language === 'hi' ? 'active' : ''} onClick={() => app.setLanguage('hi')}>हिंदी</button></span></div>
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
          {(['layers', 'zones', 'route', 'upload', 'pulse', 'camera', 'alerts'] as const).map((t) => <button key={t} className={`ca-tool ${tool === t ? 'active' : ''}`} onClick={() => { toggle(t); app.select(null) }}>{T(`tool.${t}` as StringKey)}</button>)}
        </div>
        {tool === 'layers' && <LayersPanel app={app} />}
      </div>
      {tool === 'zones' && !app.selection && <ZonesPanel app={app} />}
      {tool === 'route' && !app.selection && <RoutePanel app={app} />}
      {tool === 'upload' && !app.selection && <UploadPanel app={app} />}
      {tool === 'pulse' && !app.selection && <PulsePanel app={app} />}
      {tool === 'camera' && <VisionPanel app={app} />}
      {tool === 'alerts' && <AlertsPanel app={app} />}
      <InspectorPanel app={app} />
      <AskPanel app={app} />
      <Legend app={app} />
      <Timeline app={app} />
      {app.pointPick && <div className="ca-hint">{app.pointPick.label} · <button className="small" onClick={() => app.cancelPick()}>{T('hint.cancel')}</button></div>}
      {app.draw.active && !app.pointPick && <div className="ca-hint">{app.draw.state?.kind === 'route' ? T('hint.route') : T('hint.draw', { k: T(`zone.${app.draw.state?.kind}` as StringKey) })}</div>}
    </div>
  )
}
