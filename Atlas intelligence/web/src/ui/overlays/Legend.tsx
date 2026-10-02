import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { makeT } from '../i18n'

/** "How sure are we?": one pill until opened; then the evidence key, the feed status and the engine numbers. */
export function Legend({ app }: { app: CityAtlas }) {
  const s = app.stats
  const T = makeT(app.language)
  const [open, setOpen] = useState(false)
  if (!open) return <button className="ca-legend-pill" onClick={() => setOpen(true)} title={app.liveStatus.detail}><span className="ca-trafficbar" aria-hidden="true" /> {T('legend.title')}</button>
  return (
    <div className="ca-panel ca-legend">
      <h3>{T('legend.title')} <button className="small" onClick={() => setOpen(false)}>{T('legend.less')}</button></h3>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--observed)' }} />{T('legend.observed')}</div>
      <div className="row"><span className="sw soft" style={{ background: 'var(--derived-soft)' }} />{T('legend.derived')}</div>
      <div className="row"><span className="sw dashed" style={{ borderColor: 'var(--predicted)' }} />{T('legend.predicted')}</div>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--simulated)' }} />{T('legend.simulated')}</div>
      <div className="row"><span className="sw" style={{ borderImage: 'linear-gradient(90deg,#2e9e4f,#f5a623,#e03c31,#8f1b1b) 1', borderTopWidth: 3 }} />{T('legend.traffic')}</div>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--risk)', borderTopStyle: 'dotted' }} />{T('legend.risk')}</div>
      {app.feeds && <div className="ca-stats" title={app.liveStatus.detail}>{app.liveStatus.detail}</div>}
      <div className="ca-stats">{s.fps} fps · {s.frameMs} ms · {s.agents} agents · {s.chunks} chunks{s.inFlight ? ` (+${s.inFlight})` : ''} · sim {s.simStepMs} ms · intel {s.intelMs} ms · LOD {app.lodController.lod(app.camera.zoom)}{app.lodController.demotion ? ' (budgeted)' : ''}{app.sim.mode === 'inline' ? ' · main-thread fallback' : ''}</div>
    </div>
  )
}
