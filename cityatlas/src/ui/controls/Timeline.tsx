import type { CityAtlas } from '../../app/CityAtlas'

const WINDOW_MS = 2 * 3600_000

function fmt(ts: number): string { return new Date(ts).toISOString().slice(11, 19) + ' UTC' }
function fmtDate(ts: number): string { return new Date(ts).toISOString().slice(0, 10) }

/** Timeline: scrub ±2 h around the live clock. Past = recorded replay; future = labelled simulation. */
export function Timeline({ app }: { app: CityAtlas }) {
  const t = app.temporal.current
  const live = app.temporal.liveTimestamp()
  const min = live - WINDOW_MS, max = live + WINDOW_MS
  const value = Math.max(min, Math.min(max, t.timestamp))
  const offsetMin = Math.round((t.timestamp - live) / 60000)
  const label = t.mode === 'live' ? 'LIVE · simulated feed' : t.mode === 'historical' ? `REPLAY · recorded · ${offsetMin} min` : t.resimulated ? `RE-SIMULATED · no recording · ${offsetMin} min` : `SIMULATION · +${offsetMin} min`
  const recordedMin = Number.isFinite(app.recorder.from) ? Math.max(0, Math.round((live - app.recorder.from) / 60000)) : 0
  const lag = app.stats.simLagS
  return (
    <div className="ca-timeline">
      <div className="ctl">
        <button onClick={() => app.temporal.togglePause()} title="space">{t.paused ? '▶' : '❚❚'}</button>
        <button className={t.mode === 'live' ? 'active' : ''} onClick={() => app.temporal.goLive()}>LIVE</button>
        {[1, 5, 20].map((s) => <button key={s} className={t.mode !== 'live' && t.speed === s ? 'active' : ''} onClick={() => app.temporal.setSpeed(s)}>{s}×</button>)}
      </div>
      <div className="scrub">
        <input type="range" min={min} max={max} step={30000} value={value} onChange={(e) => app.temporal.seek(Number(e.target.value))} />
        <div className="ticks"><span>−2 h · replay covers last {recordedMin} min, earlier is re-simulated</span><span>now{lag > 5 ? ` · simulating… ${lag}s behind` : ''}</span><span>+2 h · simulation</span></div>
      </div>
      <div className="clock">
        <span className={`ca-badge ${t.mode}`}>{label}</span>
        <small>{fmtDate(t.timestamp)} {fmt(t.timestamp)}</small>
      </div>
    </div>
  )
}
