import type { CityAtlas } from '../../app/CityAtlas'
import { makeT } from '../i18n'

const WINDOW_MS = 2 * 3600_000

function fmt(ts: number): string { return new Date(ts).toISOString().slice(11, 19) + ' UTC' }
function fmtDate(ts: number): string { return new Date(ts).toISOString().slice(0, 10) }

/** Timeline: scrub ±2 h around the live clock. Past = recorded replay; future = labelled simulation. */
export function Timeline({ app }: { app: CityAtlas }) {
  const t = app.temporal.current
  const T = makeT(app.language)
  const live = app.temporal.liveTimestamp()
  const simulate = app.region.simulation
  const min = live - WINDOW_MS, max = simulate ? live + WINDOW_MS : live
  const value = Math.max(min, Math.min(max, t.timestamp))
  const offsetMin = Math.round((t.timestamp - live) / 60000)
  const label = t.mode === 'live' ? `${T('time.live')} · ${app.liveStatus.label}` : t.mode === 'historical' ? T('time.replay', { n: offsetMin }) : t.resimulated ? T('time.resim', { n: offsetMin }) : T('time.sim', { n: offsetMin })
  const recordedMin = Number.isFinite(app.recorder.from) ? Math.max(0, Math.round((live - app.recorder.from) / 60000)) : 0
  const lag = app.stats.simLagS
  return (
    <div className="ca-timeline">
      <div className="ctl">
        <button onClick={() => app.temporal.togglePause()} title="space">{t.paused ? '▶' : '❚❚'}</button>
        <button className={t.mode === 'live' ? 'active' : ''} onClick={() => app.temporal.goLive()}>{T('time.live')}</button>
        {simulate && [1, 5, 20].map((s) => <button key={s} className={t.mode !== 'live' && t.speed === s ? 'active' : ''} onClick={() => app.temporal.setSpeed(s)}>{s}×</button>)}
      </div>
      <div className="scrub">
        <input type="range" min={min} max={max} step={30000} value={value} onChange={(e) => app.temporal.seek(Number(e.target.value))} />
        <div className="ticks"><span><b>{T('time.past')}</b> · {T('time.left', { n: recordedMin })}</span><span><b>{T('time.today')}</b>{lag > 5 ? ` · ${T('time.behind', { n: lag })}` : ''}</span><span title={T('time.future.soon')}><b>{T('time.future')}</b> · {simulate ? T('time.right') : T('time.nofuture')}</span></div>
      </div>
      <div className="clock">
        <span className={`ca-badge ${t.mode}`}>{label}</span>
        <small>{fmtDate(t.timestamp)} {fmt(t.timestamp)}</small>
      </div>
    </div>
  )
}
