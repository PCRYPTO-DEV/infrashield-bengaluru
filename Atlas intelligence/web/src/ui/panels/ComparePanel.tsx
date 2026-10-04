import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { PlaceState } from '../../data/adapters/placeAdapter'
import { bestMatch } from '../../intelligence/place/relevance'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'

const PRIORITIES = ['traffic', 'safety', 'air', 'access_school', 'access_health', 'access_transport', 'green', 'walkability', 'shopping', 'noise']

/** Compare up to three areas on the priorities a person picks. The best match is for those priorities only. */
export function ComparePanel({ app, places, onRemove }: { app: CityAtlas; places: Array<{ name: string; state: PlaceState }>; onRemove: (i: number) => void }) {
  const T = makeT(app.language)
  const [pri, setPri] = useState<string[]>(['traffic', 'safety', 'access_transport'])
  const toggle = (k: string) => setPri((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  const rows = bestMatch(places, pri)
  const best = rows.filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!)[0]
  return (
    <div className="ca-panel ca-side ca-compare">
      <h3>{T('compare.title')}</h3>
      <TierGate app={app} feature="compare">
        <p className="note">{T('compare.help')}</p>
        {places.length === 0 && <p className="note">{T('compare.empty')}</p>}
        <div className="ca-kinds">{PRIORITIES.map((k) => <button key={k} className={pri.includes(k) ? 'active' : ''} onClick={() => toggle(k)}>{T(`dim.${k}` as StringKey)}</button>)}</div>
        {places.length > 0 && <table><thead><tr><th></th>{places.map((p, i) => <th key={i}>{p.name}<button className="small" onClick={() => onRemove(i)}>×</button></th>)}</tr></thead>
          <tbody>
            {pri.map((k) => <tr key={k}><td>{T(`dim.${k}` as StringKey)}</td>{rows.map((r, i) => <td key={i}>{r.perPriority[k] === null || r.perPriority[k] === undefined ? T('place.nodata') : Math.round(r.perPriority[k]!)}</td>)}</tr>)}
            <tr className="ca-compare-total"><td>{T('compare.best')}</td>{rows.map((r, i) => <td key={i} className={best && r.name === best.name ? 'best' : ''}>{r.score ?? '–'}</td>)}</tr>
          </tbody></table>}
      </TierGate>
    </div>
  )
}
