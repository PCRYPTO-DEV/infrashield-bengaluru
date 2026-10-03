import type { CityAtlas } from '../../app/CityAtlas'
import { makeT, type StringKey } from '../i18n'
import { severityBand } from '../overlays/InsightBubbles'

/** For the people who run the city: every current finding, ranked, with its source and a way to the spot. */
export function InsightsPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const list = app.insights
  return (
    <div className="ca-panel ca-side ca-insights">
      <h3>{T('ins.title')} <button className="small" onClick={() => app.setSound(!app.sound)}>{app.sound ? T('ins.soundon') : T('ins.soundoff')}</button></h3>
      <p className="note">{T('ins.help')}</p>
      {list.length === 0 && <p className="note">{T('ins.none')}</p>}
      <ul className="ca-inslist">
        {list.map((i) => (
          <li key={i.id} className={`sev-${severityBand(i)}`}>
            <div className="ca-ins-head"><span className="ca-ins-dot" /><span className="ca-ins-txt">{T(i.key as StringKey, i.vars)}</span></div>
            <div className="ca-ins-meta"><span className={`ca-badge ${i.classification}`}>{T.cls(i.classification)}</span> {i.source} · {Math.round(i.severity * 100)}{i.point && <button className="small" onClick={() => { app.flyTo(i.point!); app.select(null) }}>{T('ins.where')}</button>}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
