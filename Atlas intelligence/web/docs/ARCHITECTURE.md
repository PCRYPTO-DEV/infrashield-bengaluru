# Atlas Infinity architecture

## Layers

```
                       Atlas Infinity UI            src/ui            React: panels, timeline, inspector, ask
                            │
                     Interaction Layer         src/interaction   Camera, hit testing, zone drawing, search
                            │
                      World Renderer           src/rendering     CityRenderer = SVG static tier + Canvas dynamic tier, LOD, modes
                            │
                  Procedural City Engine       src/engine/procedural, src/engine/chunks
                            │                  grammar (roads, blocks, buildings, signals, incidents), generateChunk, generateDistrict, CityChunkManager
                      Urban World Model        src/engine/world  WorldModel: entities + spatial index + road graph + agent mirror + external layers
            ┌───────────────┼────────────────┐
        Observation      Analytics        Prediction            src/intelligence
     (adapters, cv)   flow · density    movement predictor      pipeline.ts wires IntelligenceModule<I,O> instances
                      activity · risk   congestion forecast
                      anomaly · memory  (reasoning: Ask the City; routing; business)
            └───────────────┼────────────────┘
                       Spatial Engine          src/geo           lng/lat ↔ Web Mercator ↔ local frame, XYZ tiles, grid index, geometry
                            │
                       Data Adapters           src/data          DataAdapter<T>: synthetic · GeoJSON · OSM/Overpass · upload · mock realtime · feeds
```

Workers (`src/workers`): a shared **world generation pool** (street and
district tiers) and a **simulation worker**. The main thread renders, runs
the UI, runs the (cheap, 2 Hz) intelligence pass and reconciles chunks.

## The honesty model

`EvidenceMetadata { classification, source, timestamp, confidence, model,
datasetVersion }` is mandatory on every `UrbanEntity` and on every analytic
output. The rule that holds the system together:

- the **generators** emit `simulated`;
- the **adapters** emit `observed` (with per-field provenance where the
  source is partial, e.g. OSM `speedLimitSource: 'class-default'`);
- the **analysers** emit `derived`;
- the **predictors** emit `predicted`;
- the **renderers** style by classification and never by source;
- the **explainer** (Ask the City) only sees evidence items and the answer's
  classification is the weakest class among them.

The temporal engine extends this to time: `historical` is only claimed when
a recording exists (`SnapshotRecorder`); otherwise the past is
`resimulated` and labelled so.

## The infinite city pipeline

```
camera moves
  → Camera.viewBounds()                        local world units (Mercator metres minus a frame origin)
  → CityChunkManager.update(view, centre)       required tiles = tilesInBounds(view, pad) ∩ nearest `budget`
      · dedupe in-flight requests by key
      · priority = distance to viewport centre
      · cancel requests that left the prefetch area (AbortController)
      · unload beyond unloadPad; LRU beyond maxChunks; budget disc when zoomed out
  → WorldGenerationClient (worker pool)         generateChunk(req) — pure function of (globalSeed, tileId, datasetVersion, hourBucket)
      · road grammar → blocks → buildings/parks/construction/transit → signals → incidents
      · canonical UrbanEntities (lng/lat) + RoadGraphData + RenderChunk + 3 pre-built SVG strings (one per LOD)
  → 'loaded' event
      · WorldModel.addChunk  (entities indexed, graph merged, incidents registered)
      · CompositeRenderer.addChunk (one <g> whose innerHTML is chunk.svg[lod])
      · SimulationClient.addChunk (graph + incidents + population budget → worker spawns agents deterministically)
  → every frame: SVG root viewBox ← camera; Canvas transform ← camera; agents extrapolated from last snapshot
  → 'unloaded' event: reverse of the above
```

Two tiers share the pool: **street** (zoom 16, ≈600 m, budget 42) and
**district** (zoom 13, ≈4.8 km, budget 120, no graph, no agents). The
district tier fades out between zoom 14.4 and 15.4; the street tier fades to
25 % at city LOD so the two read as one picture.

### Determinism

`worldSeed = hashMix(globalSeed, tileId, simulationTime, datasetVersion, stream)`.
Every grammar stage forks its own `PRNG`; cross-tile continuity is obtained
by deriving vertical street lines from the tile column and horizontal ones
from the tile row (see `grammar/roads.ts`), and splitting each owned edge
road at the union of both neighbours' interior lines so node ids
(`nodeId(x, y)`) coincide. Tests assert byte-identical regeneration,
seed sensitivity and shared boundary nodes.

Agents: spawn PRNG per (globalSeed, chunk); per-agent forks; fixed-step
integration; the same chunk set and the same `(dt, time)` sequence produce
identical snapshots (tested). Big time jumps are integrated incrementally
(≤ 400 steps per tick, 0.5 s steps while > 2 min behind) so the worker
never stalls; the timeline shows "simulating… Ns behind".

## World model

`WorldModel` is the single source of truth on the main thread: a `Map` of
`IndexedEntity` (entity + local geometry + bounds) in a `GridIndex`, the
merged `RoadGraph`, the agent mirror (`AgentView` with a sampled history for
trails, stop detection and prediction), resident chunks and external
layers. Renderers, analysers and queries only ever read it.

## Simulation (`engine/simulation`)

- `RoadGraph`: directed edges, per-chunk ownership, shared boundary nodes,
  signal programmes, active incidents by edge.
- `MovementEngine`: IDM car-following with leader lookup across the next
  edge, signal stop lines (`signalPhase(props, t)` is a pure function of
  time), incident crawl/queueing, route choice (straight-on bias, class
  weights), pedestrians on sidewalks with dwell pauses, and a small
  population of *erratic* and *wrong-side* drivers so detectors have
  something to find. All of it is labelled `simulated`.
- `TemporalEngine`: live / historical / simulation, speed, pause, seek,
  recorded range, `resimulated` flag.
- `SnapshotRecorder`: 2 s ring buffer (10 min) for honest replay.

## Intelligence (`intelligence`)

Pipeline order: flow → density → activity → anomalies → route risk →
congestion forecast → movement predictions (selected + a handful in view).
History (last 30 flow/density reports) feeds temporal rules.

Anomaly signals, each with concrete evidence strings: wrong way, unusual
stop, density surge, speed drop vs free-flow baseline, restricted-zone
entry, long dwell, flow divergence (z-score vs rolling baseline).

Prediction: constant-velocity fallback; road-constrained most-likely path
with one alternative branch; envelope radius grows with horizon and speed
variance; confidence decays with horizon. Congestion forecast: damped linear
trend per edge, confidence decaying with horizon.

Reasoning: `parseIntent` (rules) → `gather` (spatial queries against the
world model, intelligence state, memory, site scorer, pulse) →
`ExplanationProvider` (template by default; an LLM provider receives only
the evidence list).

Routing: Dijkstra with `C = α·travelTime + β·incidentRisk + γ·congestion +
δ·pedestrianRisk + ε·environmental`; weights configurable in the UI; the
explanation says "lower estimated risk according to currently available
signals; this is not a guarantee of safety".

Business: `scoreSites(ctx, bounds, modules)`; modules are `ScoringModule`
objects (footfall proxy, accessibility, competition, office density,
residential density, transit, time-of-day activity). New questions add
modules; the engine is untouched.

Memory: `UrbanMemory` — events by location cell and time; `near`, `between`,
`timeline`, `patterns`. City Pulse: five categories with their measurements;
environment reports "no data".

## Zones, data, CV

- `ZoneEngine`: polygon / line / radius / corridor → ring; entry, exit, dwell,
  count, direction (8-bin histogram), speed, density events and per-zone stats.
- `data/schemas/validate.ts`: strict GeoJSON validation (types, ranges,
  nesting, ring/line sizes, feature cap), CSV tokenizer, JSON record arrays;
  10 MB limit; nothing is ever evaluated.
- Adapters implement `DataAdapter<T> { connect, fetch(bounds, time), normalize }`.
- `cv/`: `CameraPipeline` = detections → `Tracker` (SORT-like) → stable ids →
  trajectories → homography to ground → speed, heading, dwell → observed
  `UrbanEntity`s. Detector adapters for COCO-SSD and ONNX/YOLO take injected
  loaders so no model library is bundled.

## Rendering

`CityRenderer { render(state), resize, dispose }` is implemented by
`CompositeRenderer`:

- `StaticSvgRenderer`: `<svg>` with a district `<g>` and a street `<g>`;
  per-chunk `<g>` innerHTML swapped only on arrival or LOD flip; viewBox per
  frame. Label visibility is a CSS attribute toggle.
- `DynamicCanvasRenderer`: one world transform; derived overlays (flow,
  density, activity pulses, risk contours, forecast), zones, uploaded
  layers, signal phases, agents (extrapolated), incidents, anomalies,
  predictions, route, drawing state, highlights, selection, and the
  mode-specific vignettes.

`LodController` picks city / neighbourhood / street by zoom and demotes up
to two levels when frames exceed 20 ms for 30 consecutive frames.

## Performance (measured in headless Chromium, 1440×900, software GL)

| scene | fps | main-thread ms | agents | chunks |
|---|---|---|---|---|
| street LOD, 42 chunks | 58–59 | 1.5–2 | ~2,900 | 42 |
| city LOD, 52 street + 120 district | 58–59 | 0.7–3 | ~3,600 | 172 |
| after +40 min jump and return to live | 55 | 1.8 | ~3,300 | 48 |

Simulation step 0.2–4.5 ms in the worker; intelligence pass 20–35 ms at
2 Hz on the main thread (candidate for the AnalyticsWorker below).

## Deviations from the directive

- `src/entities/` holds the canonical types; per-type folders
  (`roads/`, `buildings/`, …) would have been near-empty, since generation
  lives in `engine/procedural/grammar` and behaviour in `engine/simulation`.
- `src/zones/` and `src/cv/` are top-level rather than under `entities/` or
  `data/`, because both are consumed by intelligence and UI alike.
- `intelligence/routing`, `business`, `memory`, `pulse` sit beside the four
  named sub-packages because they are modules of the same engine.
- `UrbanEntityType` adds `park`, `intersection`, `construction` to the listed
  set; the renderer and inspector need them as first-class objects.
- No `AnalyticsWorker` yet: the pass is cheap at demo scale and runs at
  2 Hz on the main thread. The pipeline is pure over `WorldModel`, so moving
  it is a transport change, not a refactor.
- Chunks are not persisted to IndexedDB; regeneration is deterministic and
  faster than a disk round-trip at this size.
- MapLibre and Turf are not used (see `DEPENDENCIES.md`).

## Known limitations and next steps

1. The road grammar is a jittered grid; real OSM ways should replace it per
   tile through the same `ChunkData` contract (`generateChunk` becomes one
   of two chunk sources).
2. Historical replay holds 10 minutes in memory; longer history needs
   IndexedDB persistence of recorded snapshots and memory events.
3. Street-tier SVG strings are 60–120 KB each; a WebGL static tier is the
   next step for low-end devices (the renderer interface is designed for it).
4. The LLM explanation provider is an interface with a template default; a
   Claude-backed provider is a drop-in that receives only `EvidenceItem[]`.
5. Pedestrian movement is sidewalk-following only; crossings and desire
   lines are not modelled.
6. The CV adapter is tested with scripted detections, not a live model.
