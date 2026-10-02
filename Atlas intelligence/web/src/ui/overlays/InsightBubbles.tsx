import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { Insight } from '../../intelligence/insights/insightEngine'
import { makeT, type StringKey } from '../i18n'
import { bleep } from '../bleep'

/**
 * Comic-style callouts on the map: each new insight pops up once at its
 * place, with a bleep, and settles. Tap one to open the Insights panel.
 */
export function InsightBubbles({ app, onOpen, onReport }: { app: CityAtlas; onOpen: () => void; onReport?: () => void }) {
  const T = makeT(app.language)
  const seen = useRef(new Set<string>())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const withPoint = app.insights.filter((i) => i.point && !dismissed.has(i.id)).slice(0, 4)
  // people's reports: pink, and they stay for the day (the server forgets them after 24 h)
  // the comic callout pops for a new report and leaves after a while; the pink skull on the map stays for the day
  const [tick, setTick] = useState(0)
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 2000); return () => clearInterval(id) }, [])
  const firstSeen = useRef(new Map<string, number>())
  const reports = app.reports.filter((r) => { if (dismissed.has(r.id)) return false; let t = firstSeen.current.get(r.id); if (t === undefined) { t = Date.now(); firstSeen.current.set(r.id, t) } return Date.now() - t < 12_000 }).slice(0, 6)
  void tick
  useEffect(() => {
    const now = withPoint.filter((i) => !seen.current.has(i.id))
    const newReports = reports.filter((r) => !seen.current.has(r.id))
    if (!now.length && !newReports.length) return
    for (const i of now) seen.current.add(i.id)
    for (const r of newReports) seen.current.add(r.id)
    if (app.sound) bleep(newReports.length ? 0.9 : Math.max(...now.map((i) => i.severity)))
    setFresh(new Set([...now.map((i) => i.id), ...newReports.map((r) => r.id)]))
    const id = setTimeout(() => setFresh(new Set()), 900)
    return () => clearTimeout(id)
  }, [withPoint.map((i) => i.id).join('|'), reports.map((r) => r.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const local = (lng: number, lat: number) => app.camera.worldToScreen(app.localOf({ lng, lat }))
  return (
    <div className="ca-bubbles" aria-live="polite">
      {reports.map((r) => {
        const s = local(r.lng, r.lat)
        if (s.x < -200 || s.y < -100 || s.x > app.camera.width + 200 || s.y > app.camera.height + 100) return null
        const when = r.ageMin < 60 ? T('rep.min', { n: r.ageMin }) : T('rep.hr', { n: Math.round(r.ageMin / 60) })
        return (
          <div key={r.id} className={`ca-bubble crime${fresh.has(r.id) ? ' pop' : ''}`} style={{ left: s.x, top: s.y }} onClick={onReport ?? onOpen} role="button" title={r.evidence.source}>
            <span className="ca-bubble-txt">{T('rep.bubble', { kind: T(`rep.k.${r.kind}` as StringKey), when })}{r.description ? ` · ${r.description}` : ''}</span>
            <span className="ca-bubble-meta">{T('rep.meta')}</span>
            <button className="ca-bubble-x" aria-label="dismiss" onClick={(e) => { e.stopPropagation(); setDismissed(new Set([...dismissed, r.id])) }}>×</button>
          </div>
        )
      })}
      {withPoint.map((i) => {
        const s = app.camera.worldToScreen(i.point!)
        if (s.x < -200 || s.y < -100 || s.x > app.camera.width + 200 || s.y > app.camera.height + 100) return null
        return (
          <div key={i.id} className={`ca-bubble ${i.kind} sev-${severityBand(i)}${fresh.has(i.id) ? ' pop' : ''}`} style={{ left: s.x, top: s.y }} onClick={onOpen} role="button" title={i.source}>
            <span className="ca-bubble-txt">{T(i.key as StringKey, i.vars)}</span>
            <span className="ca-bubble-meta">{T.cls(i.classification)} · {i.source}</span>
            <button className="ca-bubble-x" aria-label="dismiss" onClick={(e) => { e.stopPropagation(); setDismissed(new Set([...dismissed, i.id])) }}>×</button>
          </div>
        )
      })}
    </div>
  )
}

export function severityBand(i: Insight): 'low' | 'mid' | 'high' { return i.severity >= 0.75 ? 'high' : i.severity >= 0.5 ? 'mid' : 'low' }
