import { useMemo, useState } from 'react'
import { CityAtlas, DEFAULT_SEED } from '../app/CityAtlas'
import { useAppVersion } from './useApp'
import { CityView } from './CityView'
import { Timeline } from './controls/Timeline'
import { InspectorPanel } from './panels/InspectorPanel'
import { AskPanel } from './panels/AskPanel'
import { LayersPanel, PulsePanel, ZonesPanel, RoutePanel, UploadPanel, SearchBox } from './panels/SidePanels'
import { Legend } from './overlays/Legend'
import { MODES } from '../rendering/layers/modes'
import { formatWorldUri, parseWorldUri } from '../engine/seed/worldSeed'

type Tool = 'layers' | 'zones' | 'route' | 'upload' | 'pulse' | null

function seedFromUrl(): string {
  const p = new URLSearchParams(window.location.search)
  const w = p.get('world') ?? p.get('seed')
  return (w && parseWorldUri(w)?.seed) || DEFAULT_SEED
}

export default function App() {
  const [seed, setSeed] = useState(seedFromUrl)
  const app = useMemo(() => new CityAtlas(seed), [seed])
  useAppVersion(app)
  const [tool, setTool] = useState<Tool>(null)
  const [seedInput, setSeedInput] = useState(seed)
  const regenerate = () => {
    const s = parseWorldUri(seedInput)?.seed ?? seed
    try { const url = new URL(window.location.href); url.searchParams.set('world', formatWorldUri(s)); window.history.replaceState({}, '', url) } catch { /* sandboxed host: keep the seed in page state only */ }
    app.dispose(); setSeed(s)
  }
  const district = [...app.world.chunks.values()][0]?.meta.districtName
  const toggle = (t: Tool) => setTool((cur) => (cur === t ? null : t))
  return (
    <div className="ca-app">
      <CityView key={seed} app={app} />
      <div className="ca-top">
        <h1 className="ca-wordmark">CITYATLAS</h1>
        <p className="ca-tagline">Infinite living city · Bengaluru demo region{district ? ` · ${district}` : ''}</p>
        <div className="ca-seed">
          <span>cityatlas://world/</span>
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && regenerate()} />
          <button onClick={regenerate}>regenerate</button>
        </div>
        <div><span className="ca-badge simulated">simulated world</span> <span className="ca-badge derived" style={{ marginLeft: 4 }}>analytics derived</span></div>
      </div>
      <div className="ca-modes">{MODES.map((m) => <button key={m.id} className={app.mode === m.id ? 'active' : ''} title={m.blurb} onClick={() => app.setMode(m.id)}>{m.label}</button>)}</div>
      <div className="ca-tools">
        <SearchBox app={app} />
        <div className="ca-toolrow">
          {(['layers', 'zones', 'route', 'upload', 'pulse'] as const).map((t) => <button key={t} className={`ca-tool ${tool === t ? 'active' : ''}`} onClick={() => { toggle(t); app.select(null) }}>{t}</button>)}
        </div>
        {tool === 'layers' && <LayersPanel app={app} />}
      </div>
      {tool === 'zones' && !app.selection && <ZonesPanel app={app} />}
      {tool === 'route' && !app.selection && <RoutePanel app={app} />}
      {tool === 'upload' && !app.selection && <UploadPanel app={app} />}
      {tool === 'pulse' && !app.selection && <PulsePanel app={app} />}
      <InspectorPanel app={app} />
      <AskPanel app={app} />
      <Legend app={app} />
      <Timeline app={app} />
      {app.draw.active && <div className="ca-hint">{app.draw.state?.kind === 'route' ? 'click start, then end' : `drawing ${app.draw.state?.kind} · enter or double-click to finish · esc to cancel`}</div>}
    </div>
  )
}
