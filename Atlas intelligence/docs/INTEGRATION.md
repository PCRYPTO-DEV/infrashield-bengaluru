# Integrating with the CityAtlas app and Atlas Vision

Atlas Infinity is built as a separate app with a small, stable interface, so
the existing CityAtlas app (the Emergent build) can embed it today and the
two can be merged later without rework. The decision and its reasons:

- The CityAtlas app's source was not readable from this environment, so
  guessing its internals would have been unsafe. An iframe plus messages
  needs nothing from the host but a URL.
- Atlas Infinity runs workers, a canvas and an SVG tier at 60 fps; keeping it
  in its own document keeps the host's rendering budget untouched.
- When the CityAtlas repository is readable, the embed can be replaced by a
  direct import of `CityAtlas` (the composition root) and the React panels.

## Live demo of the integration

`https://<atlas-host>/integration/` is a stand-in for a City Atlas page: the
map embedded with `embed.js`, a question box, mode / language / theme
buttons, an **Atlas Vision** (camera) button, and two lists fed by events
from the map: the ranked **insights** and the live **camera counts**.
Copy it, or copy `integration/AtlasInfinity.jsx` into the React app.

## What to tell Emergent

Paste this into the Emergent build of the City Atlas app:

> Add a page "Atlas" that embeds Atlas Infinity. Load
> `https://<atlas-host>/embed.js` once in `index.html`. Copy the React
> component from `https://<atlas-host>/integration/AtlasInfinity.jsx` into
> `src/components/AtlasInfinity.jsx` and render
> `<AtlasInfinity host="https://<atlas-host>" lng={77.2167} lat={28.6315} zoom={16.5} mode="mobility" lang="en" theme="day" onInsights={setInsights} onCamera={setCamera} onAnswer={setAnswer} />`.
> Show the `insights` array as a ranked list (fields: `text`, `severity`,
> `classification`, `source`, `lng`, `lat`). Add an "Atlas Vision" button
> that calls `atlasRef.current.openCamera()`. Show `camera.people` and
> `camera.vehicles` while `camera.status === 'running'`. Add a language
> toggle (en / hi) and a theme toggle (day / night) that re-render the
> component with the new props. The iframe needs
> `allow="camera; microphone; geolocation"`, which embed.js sets.

## The two-minute way (Emergent or any page): `embed.js`

The deployed Atlas serves a drop-in script. No build step, no framework:

```html
<script src="https://infrashield-bengaluru.onrender.com/embed.js"></script>
<div id="atlas" style="height: 70vh"></div>
<script>
  const atlas = AtlasInfinity.mount('#atlas', {
    lng: 77.2167, lat: 28.6315, zoom: 16.5,   // Connaught Place
    mode: 'mobility',                          // reality | mobility | activity | risk | forecast | ink3d
    lang: 'hi',                                // en | hi
    theme: 'day',                              // day (white paper, default) | night (City Atlas deep night)
    tool: 'insights',                          // a panel to open at once: insights | camera | alerts | …
    place: 'maharashtra',                      // start in a state (ids in web/src/app/regions.ts), or lng/lat anywhere in India
    radius: '16px',
  })
  atlas.on('insights', (m) => renderList(m.items))   // ranked findings for authorities, with lng/lat
  atlas.on('camera', (c) => show(c.people, c.vehicles)) // Atlas Vision counts, never a frame
  atlas.openCamera()                                   // opens Atlas Vision
  atlas.on('answer', (a) => console.log(a.text, a.facts))
  atlas.on('selection', (s) => console.log('tapped', s.kind, s.id, s.lng, s.lat))
  atlas.ask('Why is traffic slow?')
  atlas.setView(77.2295, 28.6129, 17)
  atlas.setTheme?.('night')
</script>
```

In a React page (the Emergent build), the same thing as a component:

```jsx
import { useEffect, useRef } from 'react'

export function AtlasInfinityFrame({ lng, lat, zoom = 16.5, mode = 'mobility', lang = 'en', theme = 'day', onAnswer }) {
  const ref = useRef(null)
  useEffect(() => {
    const atlas = window.AtlasInfinity.mount(ref.current, { lng, lat, zoom, mode, lang, theme })
    if (onAnswer) atlas.on('answer', onAnswer)
    return () => atlas.destroy()
  }, [])
  return <div ref={ref} style={{ height: '70vh', borderRadius: 16, overflow: 'hidden' }} />
}
```

Load `embed.js` once in `index.html` (`<script src="https://<atlas-host>/embed.js"></script>`).
The mount options match the URL parameters below, so a plain iframe works
too.

## Embed

```html
<iframe
  src="https://<atlas-host>/?region=ncr&lng=77.2167&lat=28.6315&zoom=16.5&mode=mobility&lang=hi&theme=day&embed=1"
  allow="camera; microphone"
  style="width:100%;height:100%;border:0"></iframe>
```

`embed=1` hides the wordmark, region switcher, seed box and the first-run
welcome card; the host owns the chrome. `theme=day` is white paper and ink
(the default); `theme=night` is the City Atlas deep-night look with the same
Google-style traffic colours. `allow="camera; microphone"` is needed for camera counts and
voice questions inside the frame.

## Messages from the host

```js
const atlas = iframe.contentWindow
atlas.postMessage({ type: 'atlas:setView', lng: 77.2295, lat: 28.6129, zoom: 17 }, '*')
atlas.postMessage({ type: 'atlas:setMode', mode: 'ink3d' }, '*')          // reality | mobility | activity | risk | forecast | ink3d
atlas.postMessage({ type: 'atlas:setLanguage', lang: 'hi' }, '*')         // en | hi
atlas.postMessage({ type: 'atlas:setTheme', theme: 'night' }, '*')        // day | night
atlas.postMessage({ type: 'atlas:openTool', tool: 'camera' }, '*')         // insights | camera | alerts | zones | route | pulse | layers | upload | null
atlas.postMessage({ type: 'atlas:ask', question: 'Why is traffic slow?' }, '*')
atlas.postMessage({ type: 'atlas:zone', name: 'Gate 2', ring: [{ lng, lat }, { lng, lat }, { lng, lat }] }, '*')
atlas.postMessage({ type: 'atlas:snapshot' }, '*')
```

## Messages to the host

```js
window.addEventListener('message', (e) => {
  switch (e.data?.type) {
    case 'atlas:ready':      // { region, seed }
    case 'atlas:view':       // { lng, lat, zoom } on camera moves (throttled to 2/s)
    case 'atlas:selection':  // { kind: 'agent' | 'entity', id, lng, lat }
    case 'atlas:answer':     // { question, text, classification, writer, facts: [{ classification, statement, source }] }
    case 'atlas:zoneEvent':  // { zone, kind, description, time }
    case 'atlas:snapshot':   // { facts: [...] }
    case 'atlas:insights':   // { items: [{ id, kind, severity, text, classification, source, lng, lat }] }
    case 'atlas:camera':     // { status, people, vehicles, detector }  (never a frame)
  }
})
```

Restrict origins in production by passing `allowedOrigins` to
`installEmbed` (see `web/src/app/embed.ts`).

## Atlas Vision

"Atlas Vision" in the original directive is the single-camera product. In
Atlas Infinity it is the camera panel: a calibrated phone or laptop camera
produces observed dots, and the ln engine draws the known street from that
camera's eye with the dots on top. A host app that already has camera
feeds can skip the panel and post observations directly: convert each
detection to an `atlas:zone`-style message, or run `VisionSession` and
`CameraPipeline` from `web/src/cv/` inside the host and call
`CityAtlas.onVisionObservations(obs)`.

## Server API the host can call directly

| endpoint | returns |
|---|---|
| `GET /api/health` | status and which feeds are configured |
| `GET /api/regions` | regions and their origins |
| `GET /api/tiles/osm/{z}/{x}/{y}.json?tier=street\|district` | normalised OpenStreetMap entities |
| `GET /api/traffic/flow/{z}/{x}/{y}` | TomTom flow segments with `trafficLevel` |
| `GET /api/traffic/incidents?bbox=w,s,e,n` | incidents |
| `GET /api/weather?lat&lng` | current weather |
| `POST /api/explain` · `POST /api/ask` | plain-words text from facts |
