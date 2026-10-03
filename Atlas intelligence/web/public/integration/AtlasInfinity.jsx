import { useEffect, useRef, useState } from 'react'

/**
 * Atlas Infinity inside the City Atlas app (Emergent or any React app).
 * Load <script src="https://<atlas-host>/embed.js"></script> once in index.html, then:
 *
 *   <AtlasInfinity host="https://<atlas-host>" lng={77.2167} lat={28.6315} zoom={16.5}
 *                  mode="mobility" lang="hi" theme="day" tool="insights"
 *                  onAnswer={(a) => ...} onInsights={(items) => ...} onCamera={(c) => ...} />
 *
 * Ref methods: atlasRef.current.ask('Why is traffic slow?'), .openCamera(), .setView(lng, lat, zoom), .openTool('insights')
 */
export function AtlasInfinity({ host, lng, lat, zoom = 16.5, mode = 'mobility', lang = 'en', theme = 'day', tool, place, style, onAnswer, onInsights, onCamera, onSelection, onReady, atlasRef }) {
  const el = useRef(null)
  const [atlas, setAtlas] = useState(null)
  useEffect(() => {
    if (!window.AtlasInfinity) { console.error('embed.js is not loaded'); return }
    const a = window.AtlasInfinity.mount(el.current, { host, lng, lat, zoom, mode, lang, theme, tool, place })
    if (onAnswer) a.on('answer', onAnswer)
    if (onInsights) a.on('insights', (m) => onInsights(m.items))
    if (onCamera) a.on('camera', onCamera)
    if (onSelection) a.on('selection', onSelection)
    if (onReady) a.on('ready', onReady)
    if (atlasRef) atlasRef.current = a
    setAtlas(a)
    return () => a.destroy()
  }, [host, place]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (atlas && lng != null && lat != null) atlas.setView(lng, lat, zoom) }, [atlas, lng, lat, zoom])
  useEffect(() => { if (atlas) atlas.setMode(mode) }, [atlas, mode])
  useEffect(() => { if (atlas) atlas.setLanguage(lang) }, [atlas, lang])
  useEffect(() => { if (atlas) atlas.setTheme(theme) }, [atlas, theme])
  return <div ref={el} style={{ height: '70vh', borderRadius: 16, overflow: 'hidden', ...style }} />
}

export default AtlasInfinity
