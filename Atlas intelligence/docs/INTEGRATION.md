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

## Embed

```html
<iframe
  src="https://<atlas-host>/?region=ncr&lng=77.2167&lat=28.6315&zoom=16.5&mode=mobility&lang=hi&embed=1"
  allow="camera; microphone"
  style="width:100%;height:100%;border:0"></iframe>
```

`embed=1` hides the wordmark, region switcher and seed box; the host owns
the chrome. `allow="camera; microphone"` is needed for camera counts and
voice questions inside the frame.

## Messages from the host

```js
const atlas = iframe.contentWindow
atlas.postMessage({ type: 'atlas:setView', lng: 77.2295, lat: 28.6129, zoom: 17 }, '*')
atlas.postMessage({ type: 'atlas:setMode', mode: 'ink3d' }, '*')          // reality | mobility | activity | risk | forecast | ink3d
atlas.postMessage({ type: 'atlas:setLanguage', lang: 'hi' }, '*')         // en | hi
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
