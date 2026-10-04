import { useEffect } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { makeT, type StringKey } from '../i18n'

const KEYS = ['traffic', 'air', 'rain', 'safety'] as const

/** AROUND YOU: five plain words for the centre of the view, each from the city model, each clickable for the WHY. */
export function AroundYou({ app, onOpen }: { app: CityAtlas; onOpen: () => void }) {
  const T = makeT(app.language)
  useEffect(() => { void app.refreshAround(); const id = setInterval(() => void app.refreshAround(), 20000); return () => clearInterval(id) }, [app])
  const st = app.around
  if (!st) return null
  const by = Object.fromEntries(st.dimensions.map((d) => [d.key, d]))
  const unusual = app.changes?.count ?? app.insights.length
  return (
    <div className="ca-around" role="group" aria-label={T('around.title')}>
      <span className="ca-around-title">{T('around.title')}</span>
      {KEYS.map((k) => { const d = by[k]; const band = d?.score === null || !d ? null : d.score >= 60 ? 'ok' : d.score >= 40 ? 'mid' : 'bad'; return <button key={k} className={`ca-around-chip ${band ?? 'none'}`} onClick={() => { void app.openPlace(app.camera.centre); onOpen() }}><span>{T(`dim.${k}` as StringKey)}</span><b>{d && d.band ? T(`band.${d.band}` as StringKey) : T('place.nodata')}</b></button> })}
      <button className={`ca-around-chip ${unusual ? 'mid' : 'ok'}`} onClick={onOpen}><span>{T('around.unusual')}</span><b>{unusual}</b></button>
    </div>
  )
}
