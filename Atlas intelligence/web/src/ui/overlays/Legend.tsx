import type { CityAtlas } from '../../app/CityAtlas'
import { makeT } from '../i18n'

export function Legend({ app }: { app: CityAtlas }) {
  const s = app.stats
  const T = makeT(app.language)
  return (
    <div className="ca-panel ca-legend">
      <h3>{T('legend.title')}</h3>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--observed)' }} />{T('legend.observed')}</div>
      <div className="row"><span className="sw soft" style={{ background: 'rgba(47,127,134,0.25)' }} />{T('legend.derived')}</div>
      <div className="row"><span className="sw dashed" style={{ borderColor: 'var(--predicted)' }} />{T('legend.predicted')}</div>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--simulated)' }} />{T('legend.simulated')}</div>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--risk)', borderTopStyle: 'dotted' }} />{T('legend.risk')}</div>
      {app.feeds && <div className="ca-stats" title={app.liveStatus.detail}>{app.liveStatus.detail}</div>}
      <div className="ca-stats">{s.fps} fps · {s.frameMs} ms · {s.agents} agents · {s.chunks} chunks{s.inFlight ? ` (+${s.inFlight})` : ''} · sim {s.simStepMs} ms · intel {s.intelMs} ms · LOD {app.lodController.lod(app.camera.zoom)}{app.lodController.demotion ? ' (budgeted)' : ''}{app.sim.mode === 'inline' ? ' · main-thread fallback' : ''}</div>
    </div>
  )
}
