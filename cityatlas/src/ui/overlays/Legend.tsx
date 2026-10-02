import type { CityAtlas } from '../../app/CityAtlas'

export function Legend({ app }: { app: CityAtlas }) {
  const s = app.stats
  return (
    <div className="ca-panel ca-legend">
      <h3>Evidence</h3>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--observed)' }} />observed · solid</div>
      <div className="row"><span className="sw soft" style={{ background: 'rgba(47,127,134,0.25)' }} />derived · soft overlay</div>
      <div className="row"><span className="sw dashed" style={{ borderColor: 'var(--predicted)' }} />predicted · ghost, dashed</div>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--simulated)' }} />simulated · labelled, violet tint when ahead of now</div>
      <div className="row"><span className="sw" style={{ borderColor: 'var(--risk)', borderTopStyle: 'dotted' }} />incident / risk · contour rings</div>
      <div className="ca-stats">{s.fps} fps · {s.frameMs} ms · {s.agents} agents · {s.chunks} chunks{s.inFlight ? ` (+${s.inFlight})` : ''} · sim {s.simStepMs} ms · intel {s.intelMs} ms · LOD {app.lodController.lod(app.camera.zoom)}{app.lodController.demotion ? ' (budgeted)' : ''}{app.sim.mode === 'inline' ? ' · main-thread fallback' : ''}</div>
    </div>
  )
}
