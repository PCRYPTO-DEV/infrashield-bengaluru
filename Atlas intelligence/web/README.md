# Atlas Infinity

A procedural, data-driven urban intelligence engine. Where a map answers
*where is something?*, Atlas Infinity is built to answer *what is happening here,
why, what is unusual, what may happen next, and what should I pay attention
to?* — and to say, for every object on screen, how it knows.

It grew out of the open-source landscape engine
[{Shan, Shui}*](https://github.com/LingDong-/shan-shui-inf): the idea of a
world that is planned, generated and drawn chunk by chunk as the viewport
moves, from a seed, as vector ink on paper. The study of that engine and the
decisions about what to keep are in
[`../docs/SHAN_SHUI_ARCHITECTURE.md`](../docs/SHAN_SHUI_ARCHITECTURE.md).

```
cd cityatlas
npm install
npm run dev        # http://localhost:5174
npm test           # vitest
npm run build      # typecheck + production bundle
```

Open `http://localhost:5174/?world=atlas://world/bengaluru-2026` — any
seed string produces a different, reproducible city anchored on the Bengaluru
demo region.

## The honesty model

Every entity carries evidence metadata and renderers style by it:

| classification | meaning | drawn as |
|---|---|---|
| `observed`  | directly supported by observed data (OSM, uploads, camera tracks, feeds) | solid ink |
| `derived`   | calculated from observations (flow, density, anomalies, risk) | soft teal overlays |
| `predicted` | what the system believes may happen (paths, congestion forecast) | dashed violet ghosts with envelopes |
| `simulated` | generated content with no observation behind it (the whole demo city) | labelled; violet vignette when the clock runs ahead of now |

Inference and prediction are never drawn as reality. The timeline says
*replay* only where a recording exists and *re-simulated* where it does not.
The environment category of City Pulse shows "no data" rather than a number.

## What is in the demo

- An infinite, seeded city: roads, intersections, buildings, parks,
  construction, transit, signals and incidents generated per Web Mercator
  tile in a worker pool and cached by `CityChunkManager`.
- Two LOD tiers: street chunks (zoom 16) with a hard budget, and cheap
  district tiles (zoom 13) that cover the rest of the city view.
- A deterministic traffic and pedestrian simulation in a worker (IDM
  car-following, signal phases, incident queues, route choice).
- An intelligence pipeline: traffic flow, density, urban activity, route
  risk, explainable anomalies, movement prediction with confidence
  envelopes, congestion forecast.
- Time as a dimension: live, recorded replay, fast-forward simulation.
- Monitoring zones (polygon, line, radius, corridor) with entry/exit/dwell/
  count/direction/speed/density rules.
- Safer routing with configurable cost weights and a factor breakdown.
- Business mode scoring ("where should I open a café?") as pluggable modules.
- Urban memory (time-series events per location) and City Pulse.
- Ask the City: intent → spatial query → analytics → structured evidence →
  explanation. The explainer only ever sees the evidence.
- Data adapters: synthetic, GeoJSON, OpenStreetMap (Overpass), uploaded
  datasets (GeoJSON / JSON / CSV ≤ 10 MB, validated, never executed), mock
  realtime feed; WebSocket / EventSource feed abstraction.
- Computer-vision adapter: calibration homography, SORT-style tracker,
  camera pipeline producing observed `UrbanEntity` streams; detector
  interfaces for COCO-SSD and ONNX/YOLO without bundling either.

## Interaction

| action | how |
|---|---|
| pan / zoom | drag, wheel, arrow keys, `+` / `-` |
| select / inspect | click an object (vehicle, pedestrian, building, road, signal, incident, transit) |
| modes | Reality · Mobility · Activity · Risk · Forecast |
| layers | Layers panel toggles every static and derived layer |
| draw zone | Zones → polygon / line / radius / corridor; Enter or double-click finishes; Esc cancels |
| route | Route → Pick endpoints; adjust α…ε weights |
| time | timeline scrubber, play/pause (space), 1× 5× 20×, LIVE |
| ask | the Ask the City bar (bottom-left) |
| upload | Upload panel; GeoJSON, JSON records, CSV |
| search | top-right search box (names, types, `#agentId`) |

## Layout

```
src/
  app/            CityAtlas.ts — composition root and frame loop
  engine/         seed · procedural grammar · chunks · world model · simulation
  geo/            lng/lat, Web Mercator, tiles, spatial index, geometry
  entities/       UrbanEntity + EvidenceMetadata
  data/           adapters · schemas (validation) · realtime feeds
  intelligence/   analytics · anomaly · prediction · reasoning · routing · business · memory · pulse
  zones/          monitoring zones
  cv/             camera / computer-vision adapter
  rendering/      CityRenderer, SVG static tier, Canvas dynamic tier, LOD, modes, palette
  interaction/    camera, selection, drawing, search
  workers/        world generation pool, simulation worker, clients
  ui/             React UI only
  tests/          vitest
docs/             ARCHITECTURE, DEPENDENCIES, VISUAL_LANGUAGE
```

Deviations from the directive's suggested tree are explained in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deviations-from-the-directive).

## Status

MVP. Everything in the demo region is simulated and labelled so. Real data
enters through the adapters; the first real-data milestone is replacing the
road grammar of a tile with OSM ways through the same `ChunkData` contract.
See `docs/ARCHITECTURE.md` for the roadmap and known limitations.
