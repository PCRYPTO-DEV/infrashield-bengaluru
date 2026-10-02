# Atlas Infinity architecture

The app-level architecture (chunks, world model, simulation, intelligence,
rendering tiers) is documented in [`../web/docs/ARCHITECTURE.md`](../web/docs/ARCHITECTURE.md).
This file covers the product as a whole: the server, the real-data path, the
ln merge, the camera, the writer and how the parts talk.

```
 browser                                                      server (FastAPI, one origin)
 ───────────────────────────────────────────────────────      ───────────────────────────────────────
 CityAtlas (composition root, frame loop)                      /api/tiles/osm/{z}/{x}/{y}.json  ← Overpass (cache 30 d, 1 req/s)
   ├─ CityChunkManager ──► WorldGenerationClient ──► workers   /api/traffic/flow/{z}/{x}/{y}    ← TomTom flow vector tiles (cache 120 s)
   │       street tier: osm → buildOsmChunk (fallback: organic procedural)
   │       district tier: osm-district → major roads + place names        /api/traffic/incidents?bbox=   ← TomTom Incident Details v5 (60 s)
   │       ink tier (on demand): buildInkSvg = ln hidden-line + ink strokes /api/weather?lat&lng           ← Open-Meteo (10 min)
   ├─ LiveFeeds ─────────────────────────────────────────────► /api/traffic/*, /api/weather
   │       observed flow → RoadGraph.setObservedLevels → MovementEngine caps speed to the live level
   │       observed incidents → WorldModel layer 'live:incidents' + simulation queues
   ├─ SimulationClient ──► simulation worker (IDM, signals, incidents, routes)
   ├─ IntelligencePipeline (2 Hz): flow → density → activity → anomalies → risk → forecast → predictions
   ├─ VisionSession: camera → COCO-SSD (CDN) → tracker → observed agents → zones
   ├─ ClaudeExplainer ───────────────────────────────────────► /api/explain, /api/ask  ← Anthropic Messages API
   └─ CompositeRenderer: SVG static tier (chunk <g> strings) + Canvas dynamic tier (agents, overlays)
                                                              static files: web/dist (SPA fallback)
```

## Real geography

A street tile (zoom 16, about 600 m) is requested from the server, which
runs a bounded Overpass query, normalises ways and nodes into `UrbanEntity`
records (roads with class, lanes, one-way, speed limit and its provenance;
buildings with floors and land use; signals; transit; parks; place names)
and caches the result in SQLite for 30 days. The browser turns the tile
into a `ChunkData` exactly like the procedural generator does: a road graph
whose node ids come from rounded OSM node ids so neighbouring tiles
connect, render shapes, three LOD SVG strings and simulation budgets from
road length and building density. If a tile cannot be fetched the client
falls back to the procedural tier for that tile and counts it; the top bar
shows "N tiles have no map data".

District tiles (zoom 13) carry only major roads and place names so the
zoomed-out view stays cheap.

## Organic procedural city

The fallback city is not a grid. Streets are noise-warped lines sampled on
absolute 24 m stations, so two neighbouring tiles compute bit-identical
vertices for the shared street. Crossings are computed by segment
intersection and become graph nodes; blocks are the polygon rings between
consecutive streets; buildings are lots placed along each street edge of a
block with a setback, rejected when they overlap or leave the polygon.

## The ln merge

`web/src/rendering/ln/` is a TypeScript port of the core of fogleman/ln:
vectors, matrices, boxes, rays, a k-d tree, path chop and simplify, the clip
filter, scene, cube, triangle and mesh. Atlas Infinity adds a `Prism`
(an extruded building footprint) and a `ParallelClipFilter` for parallel
projections, where visibility rays all travel in one direction.

Two uses:

1. **Ink 3D mode.** Each resident chunk is rendered on demand (in the
   generation worker) as a hidden-line 3D scene under an oblique parallel
   projection (`x' = x + 0.32 z`, `y' = y − 0.78 z`). Because the projection
   has no per-tile camera, a building in one tile lines up with the road in
   the next; because the ground plane is untouched, the moving dots on the
   canvas stay in place. Surviving lines are finished as Shan Shui-style
   strokes (filled polygons with a swelling, wobbling width). Chunk groups
   are inserted in painter's order by tile row. "Save line drawing" writes
   the chunks in view as one SVG document.
2. **Atlas Vision.** From a calibrated camera (four matched points and a
   position), the known scene is rendered from the camera's eye with a
   perspective matrix, and the dots the camera pipeline tracks are projected
   into the same frame. The video is never drawn here.

Known limit: occlusion is per tile. A tall building right at a tile edge
does not hide lines in the neighbouring tile.

## Live traffic

TomTom's relative flow vector tiles give a `traffic_level` (current speed ÷
free-flow speed) per segment. The browser matches segments to graph edges by
distance (14 m) and heading (35°) and marks those edges *observed*. The
flow analyser reports the observed level where it exists and the simulated
one elsewhere, and the inspector says which it is. The simulation caps its
cars to the observed level so what moves on screen agrees with what TomTom
measured. Incidents from the Incident Details API enter as an observed
layer and queue cars in the simulation.

## Camera counts

`VisionSession` reads frames from a `<video>` element, runs a general object
detector loaded from a CDN only when the panel opens, drops every label
outside `person, car, truck, bus, motorcycle, bicycle`, tracks boxes with a
SORT-style tracker, and maps the foot point of each box through the
calibration homography to the ground. The result is a stream of observed
agents that zones count like any other. `PRIVACY_GUARD` in code states what
the feature promises and tests check it: no frame stored or sent, no face
model.

## The AI writer

`POST /api/explain` receives the question, the detected intent and the
evidence list; `POST /api/ask` receives a free question and a snapshot of
facts the app assembled (region, time, feeds, weather, counts, slowest
roads, incidents, odd things, zones, pulse, route, selection). The system
prompt forbids any fact not in the list, demands very simple words and a
90-word limit, keeps each fact's evidence label, and writes in English or
Hindi. The model is `claude-opus-5-5` at low effort with a cached system
prompt and server-side refusal fallback. Without a key the app's template
writer answers in the same plain style, and the answer card says which
writer wrote it. Every answer lists its facts underneath.

## Language

`web/src/ui/i18n.ts` holds every string in both languages. The evidence
classes have one everyday phrase each (seen / worked out / a guess / made
up). The writer, the voice (Web Speech API, en-IN / hi-IN) and the
suggestion chips follow the same setting, which is remembered per browser.
