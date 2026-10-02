# Atlas Infinity → City Atlas: master plan (Sprint 1 deliverables)

This is the engineering answer to the master brief: *see what is, understand why, predict what comes next*, one city model serving people (City Atlas), Plus and Pro. It was written against the code as it stands, not against a blank page. Nothing in the product is ever invented: where a reading is missing the model says "no data", and every number carries how it knows (observed · derived · inferred · predicted), a confidence and its provenance.

## 1. Current architecture map

```
browser (web/)                                        server (server/app)
──────────────────────────────────────────────────    ────────────────────────────────────────────
ui/App.tsx            chrome, panels, embed params     main.py        FastAPI, lifespan (baseline + warm-up), SPA
app/CityAtlas.ts      composition root, state store    osm.py         OpenStreetMap: vector tiles → Overpass → map API, SQLite cache
app/embed.ts          postMessage API for hosts        vtiles.py      OpenMapTiles decoder (roads, names, buildings, green, POIs)
engine/chunks         Shan Shui plan→instantiate→cache tomtom.py      flow MVT + incidents, daily budget, history hook
engine/world          WorldModel, RoadGraph             weather.py     Open-Meteo current
engine/simulation     idle for real regions (no sim)    memory.py      History: flow_readings, incident_readings, camera_counts, zone_events; usual()
rendering/svg         static ink tiers, Ink 3D (ln)     alerts.py      rules + Twilio
rendering/canvas      moving layer, traffic colours     explain.py     Claude writer (facts in → words out), EchoWriter in fixtures
rendering/ln          fogleman/ln port                  cache.py       SQLite key/value with TTL
data/sources/osmChunk tile JSON → chunk                 regions.py     India (+ ncr alias)
data/realtime         LiveFeeds: flow, incidents, weather, usual, alerts, camera/zone posts
intelligence/         analytics (flow, density, activity, route risk), anomaly, prediction (forecast, movement), routing (safer),
                      business (siteScorer), pulse, memory (urbanMemory), reasoning (intentParser, askTheCity, explainers), insights
cv/                   MediaPipe / COCO detectors, tracker, calibration (4-point + pose), VisionSession
public/embed.js, public/integration/   drop-in and host demo for the City Atlas app
```

Data in: OpenStreetMap (vector tiles, Overpass, map API), TomTom flow + incidents, Open-Meteo, device camera, uploads. Data kept: every live reading (memory). Hosting: Render, one process.

Working: real streets/buildings/green anywhere in India, live traffic colours, incidents and risk, Ask the City (templates + Claude), Hindi, memory ("usual at this hour"), alerts, zones, routes with From/To, camera counts, Ink 3D and SVG export, insights with callouts, embed and host page. Broken/weak: Overpass from Render (fixed by vector tiles), Ask the City with an empty map (now says so), heavy chrome (too many permanent controls), scores and reasoning exist only as scattered analysers, no place-level intelligence, no change detection, no provenance UI, no time machine beyond ±2 h.

## 2. Keep / refactor / remove

| area | decision | why |
|---|---|---|
| Shan Shui chunk pipeline, ln port, SVG+Canvas tiers | keep | performant, distinctive, the visual language |
| feeds, memory, alerts, writer, embed, camera | keep | real-data pipes already proven |
| intelligence analysers | keep, wrap as tools | become deterministic tools the reasoning engine calls |
| intentParser + askTheCity | refactor → orchestrator | Claude chooses tools; rules stay as the no-key fallback |
| pulse | refactor → H3 city state | city level = aggregation of cells, with 24 h / 7 d change |
| UI chrome | refactor → six elements | logo, Ask Atlas, search, What changed?, time bar, map; everything else contextual |
| procedural simulation code | keep in engine for tests only | not on the product surface (real data only) |
| seed box, region buttons, welcome card | remove from default UI | replaced by home experience and state picker in search |

## 3. Proposed architecture

```
DATA SOURCES (adapters: osm, tomtom, open-meteo weather + air, camera, uploads; later gov GIS, satellite, sensors)
   ↓ normalise (entities with evidence {class, source, timestamp, confidence})
SPATIAL INDEX (H3 res 9 cells; tiles z16 for geometry)      TEMPORAL INDEX (memory tables + cell_daily snapshots)
   ↓
ENTITY GRAPH (roads/intersections graph today; cells–POIs–roads relations NEAR / SERVES / INSIDE next)
   ↓
FEATURE EXTRACTION (cells.py: state vector per cell from real readings and structure)
   ↓
ATLAS REASONING ENGINE (deterministic tools: place_state, cells_in, changes, usual, nearest, route, compare)
   ↓
PREDICTION / ANOMALY / SCENARIO (Phases 2–4)
   ↓
NATURAL-LANGUAGE EXPLANATION (Claude: interprets the question, calls tools, phrases facts; never adds one)
   ↓
MAP (ink tiers + callouts + place card)
```

Responsibilities (brief §21): LLM = interpretation, tool selection, synthesis; GIS/database = distance, joins, aggregation, routing; statistics/ML = baselines, anomalies, forecasts.

## 4. Database schema (SQLite now; PostGIS-ready)

```
cells(h3 TEXT PK, res INT, lng REAL, lat REAL)
cell_state(h3, ts, vector JSON, score REAL, confidence REAL, provenance JSON)          -- latest computed state (cache)
cell_daily(h3, day TEXT, score REAL, vector JSON, PRIMARY KEY (h3, day))               -- one snapshot per day → trends, "what changed"
air_readings(ts, lat, lng, eu_aqi, us_aqi, pm25, pm10, no2, o3)                         -- Open-Meteo air quality, kept like flow
pois(id, h3, kind, name, lng, lat, source, fetched_at)                                  -- from vector tiles, per tile fetch
changes(id, h3, ts, kind, magnitude, confidence, relevance, impact, text_en, text_hi, evidence JSON)
flow_readings / incident_readings / camera_counts / zone_events                        -- unchanged
```

## 5. H3 city model

Resolution 9 (~0.1 km², ~174 m edge) for place cards and changes; resolution 7 for city pulse. State vector per cell and time:

```
X(cell, t) = [ traffic, safety, air, rain, green, access_health, access_school, access_transport,
               walkability, connectivity, built_intensity, noise_proxy, shopping, flood(null), population(null) ]
```

Each component = `{score 0..100 | null, class, confidence, why[], provenance[]}`. Comparisons: X(t) vs X(t−1 day) (cell_daily) and vs E[X] (same weekday + hour medians from memory) drive trends, "what changed" and anomalies.

## 6. Reasoning-engine tool interfaces

```
place_state(lng, lat, res=9)          → PlaceState        (server /api/place)
cells_in(bbox, res=9)                 → CellSummary[]     (server /api/cells; cached cells only)
changes(bbox, since_s)                → Change[]          (server /api/changes)
usual(segment | cell, at)             → {now, usual, delta, samples, basis}   (memory)
nearest(kind, lng, lat, limit)        → Poi[] with distance                     (server, from pois)
route(a, b, mode: fastest|safer|flood|pedestrian|emergency) → RouteResult      (web saferRouter; modes Phase 4)
compare(places[], priorities)         → ComparisonTable   (web, from place_state)
explain(facts[], language, question)  → text              (server /api/explain, /api/ask with tool use)
```
Every tool result carries `evidence: {classification, source, timestamp, confidence}` and provenance rows `{source, timestamp, resolution, freshness}`.

## 7. Interface component hierarchy

```
App
├─ MapCanvas (CityView: SVG tiers + canvas + callouts)
├─ Home (first open: greeting, "N meaningful changes since yesterday", three prompts)
├─ AskAtlas (persistent; typed or spoken; answer card with facts + writer label)
├─ WhatChanged (control + ranked list with show-me and evidence)
├─ TimeBar (PAST · NOW · FUTURE: past = the memory's readings, future = PREDICTED from the usual hour with a confidence)
├─ PlaceCard (click anywhere: ATLAS SCORE, trend, dimensions, WHY, evidence, confidence; Live-here view; Plus: before you rent or buy)
├─ AroundYou (strip: traffic, air, rain, safety, unusual)
├─ More (contextual: layers, zones, route, upload, pulse, camera, alerts, insights, compare)
└─ TierGate (Plus password now; accounts + billing later)
```

## 8. Tiers (brief §32)

| | Free: what is here | Plus: what it means for me | Pro: what it means for a decision |
|---|---|---|---|
| Ask Atlas | basic | unlimited | with scenarios |
| Place card | basic | Live-here views, property mode | site evaluation, due diligence |
| What changed | 3 items | full, history, watchlists | opportunity engine |
| Routes | basic | safer-route intelligence | multi-objective, logistics |
| Alerts | in app | WhatsApp/SMS, personal brief | operational |
| Compare | – | 3 neighbourhoods | market intelligence |
| Scenario lab, site finder, reports, projects | – | – | Pro |

Gate today: a password (`atbose`) unlocks Plus on this browser; Pro is shown locked with its scope. Replace with accounts and billing when tested pricing exists.

## 9. Phases

Phase 1 (done): H3 state + place card + WHY + provenance + What changed + Ask Atlas chrome + tiers. Phase 2 (done in part): the time machine over the memory (`/api/history/at`), stable road ids so readings line up across days, anomaly per road vs the usual; OSM change detection waits for a second snapshot. Phase 3 (done in part): `/api/forecast/at` predicts each road from its usual hour with today's anomaly fading, labelled with a confidence; flood/heat still need elevation and rainfall adapters. Phase 4 (done in part): site finder (`/api/sites`), Scenario Lab "road closes" (`/api/route?avoid=`), Pro workspace (saved shortlists, scenarios, GeoJSON/CSV export), client report; routing modes, a calibrated traffic twin (§30) and the opportunity engine (§31.14) wait for demand and population data. Phase 5: live camera behaviour, IoT, streaming. See `docs/DECK_COVERAGE.md` for the claim-by-claim map.
