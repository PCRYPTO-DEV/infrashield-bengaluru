import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import type { Insight } from '../../intelligence/insights/insightEngine'
import { makeT, type StringKey } from '../i18n'
import { bleep } from '../bleep'

/**
 * Comic-style callouts on the map: each new insight pops up once at its
 * place, with a bleep, and settles. Tap one to open the Insights panel.
 */
export function InsightBubbles({ app, onOpen }: { app: CityAtlas; onOpen: () => void }) {
  const T = makeT(app.language)
  const seen = useRef(new Set<string>())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const withPoint = app.insights.filter((i) => i.point && !dismissed.has(i.id)).slice(0, 4)
  useEffect(() => {
    const now = withPoint.filter((i) => !seen.current.has(i.id))
    if (!now.length) return
    for (const i of now) seen.current.add(i.id)
    if (app.sound) bleep(Math.max(...now.map((i) => i.severity)))
    setFresh(new Set(now.map((i) => i.id)))
    const id = setTimeout(() => setFresh(new Set()), 900)
    return () => clearTimeout(id)
  }, [withPoint.map((i) => i.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ca-bubbles" aria-live="polite">
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
