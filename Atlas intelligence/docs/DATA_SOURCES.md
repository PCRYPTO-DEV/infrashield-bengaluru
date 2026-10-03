# Data sources

| source | what | how it enters | class | cache | cost |
|---|---|---|---|---|---|
| OpenStreetMap (Overpass API) | roads, buildings, signals, transit, parks, place names | server `/api/tiles/osm/{z}/{x}/{y}.json`, tiers `street` (z16) and `district` (z13) | observed | SQLite, 30 days | free; the public Overpass server is rate-limited, so the server sends at most 1 request/s |
| TomTom Traffic Flow (vector tiles, `relative`) | current speed ÷ free-flow speed per road segment | `/api/traffic/flow/{z}/{x}/{y}` at zoom 12, decoded server-side | observed | 120 s per tile | counts against the daily budget |
| TomTom Incident Details v5 | accidents, road works, closures, jams, with start and end times | `/api/traffic/incidents?bbox=` | observed | 60 s | counts against the daily budget |
| Open-Meteo | temperature, humidity, rain, wind, weather code | `/api/weather?lat&lng` | observed | 10 min | free, no key |
| Phone or laptop camera | people and vehicles as tracked dots | in the browser only; never uploaded | observed | none | free |
| Uploaded files | GeoJSON, JSON records, CSV with lat/lng, ≤ 10 MB | parsed and validated in the browser | observed | none | free |
| OpenStreetMap vector tiles (OpenFreeMap, OpenMapTiles schema) | the same roads, names, buildings, green areas, stations and points of interest (hospitals, schools, police, fire, pharmacies, shops), 16 street tiles per request, anywhere in the world | server `vtiles.py` → the same tile JSON; Overpass and the OSM API are the fallbacks | observed | SQLite, 30 days | free CDN |
| Open-Meteo Air Quality | European and US AQI, PM2.5, PM10, NO₂, O₃ (CAMS model, about 11 km) | `/api/air?lat&lng`; readings kept in `air_readings` | observed | 30 min | free, no key |
| OpenStreetMap history (Overpass `[date:…]` + `out count`) | how many places, premium places and food places were mapped 24/18/12/6 months ago, for 1 km and a 5 km ring (gentrification momentum) | `gentrification.py` | observed counts → derived trend | SQLite, 30 days | free; 5 count queries per area, once a month |
| Overpass places census (amenity/shop/leisure/office, BSOCIAL query) | every mapped place within 2.5 km of an H3 res-7 cell, classified with BSOCIAL's categories | `gentrification.py` → `/api/gentrification`, `/api/gentrification/grid` | observed | SQLite, 7 days | free |
| Google News RSS (area search) | headlines naming an area in the last 30 days (digital buzz) | `gentrification.py` | observed | 6 h | free, no key |
| Overpass construction count (`landuse`/`building` = construction, 1.5 km) | competing projects for the UINTEL+ supply signal | `invest.py` → `/api/invest` | observed count → derived score | SQLite, 7 days | free |
| Google News RSS (distress search) | headlines naming the area with auction, SARFAESI, NCLT, insolvency, stalled-project words, 6 months | `invest.py` | observed | 12 h | free, no key |
| Anthropic API | plain-words answers | `/api/explain`, `/api/ask` | rephrases only; never a source of facts | prompt cache | per token |

## TomTom budget

The free tier allows 2,500 requests per day. The server keeps a counter per
UTC day in its cache and refuses new calls past `TOMTOM_DAILY_BUDGET`
(default 2,000), answering 429 so the app shows "no live traffic feed yet" for
the rest of the day. The app polls flow tiles for the view it is looking at
(at most 6 tiles) every 60 s and incidents for the view's bounding box, so a
single open browser costs about 400 to 500 calls per hour at most, usually
far fewer because of the 120 s server cache. Always-on coverage of all of
NCR needs a paid tier; the status line shows today's count.

## Preloading NCR

The first visit to a tile waits on Overpass (one to several seconds). To
warm the cache for the whole region, run the server and request the tiles
you care about; a bulk preload script over the NCR bbox (lon 76.80–77.65,
lat 28.25–28.90, about 3,800 z16 tiles) can be added to `server/scripts/`
following `make_dev_fixtures.py`. A faster path for a full region is an
Osmium/pyosmium pass over the Geofabrik `northern-zone` extract producing
the same normalised JSON; the cache key format is `osm:{tier}:{z}/{x}/{y}`.

## Fixtures

`server/scripts/make_dev_fixtures.py` writes synthetic Overpass, TomTom and
weather responses into `server/dev-fixtures/` so the whole product runs
without network or keys. With `ATLAS_FIXTURES` set and no Anthropic key, an
echo writer stands in for the AI writer.

## Evidence rules

Each record carries `evidence { classification, source, timestamp,
confidence, model }`. Adapters emit `observed` with per-field provenance
where the source is partial (for example OSM speed limits marked
`class-default` when the way has no `maxspeed`). Where TomTom has no
segment, an edge has no speed and the map says so; nothing is filled in.

## The city's memory

Every fresh TomTom flow tile, every incident list, every camera count the
app posts and every zone event is written to SQLite (`flow_readings`,
`incident_readings`, `camera_counts`, `zone_events`). A baseline reader
keeps polling a few tiles on a timer so the memory grows even with nobody
watching. `GET /api/history/compare?tile=z/x/y` answers, per segment, the
level now and the median level at the same weekday and hour over the last
28 days (at least 3 readings; otherwise the same hour on any day; otherwise
"not enough readings yet"). The app shows this as "usual at this hour" on
a road, as facts in answers, and as the answer to "is it worse than
usual?". Nothing is estimated where readings are missing.

## Alerts

Rules live on the server (`/api/alerts`): a road slower than a limit for N
minutes, a camera counting more than a limit, or an event in a zone. They
are checked every time a reading arrives, fire at most once every 15
minutes each, are logged, and go out by WhatsApp or SMS through Twilio in
simple English or Hindi. Each message names its source ("seen by
TomTom", "seen by the camera") and never adds a fact.

## The H3 city model (Phase 1)

`GET /api/place?lng&lat` returns one H3 resolution-9 cell (about 0.1 km²) as a
state vector: traffic (TomTom, with the usual for this weekday and hour from
memory), safety activity (reported incidents within 800 m, 24 h), air (Open-Meteo
air quality), rain disruption (Open-Meteo), green space, access to healthcare,
schools, police, fire stations, pharmacies and public transport (nearest mapped
point of interest within about 2.5 km), walkability, connectivity, built
intensity, a noise proxy (inferred), shopping, camera counts where a camera runs,
and flood and population as "no data" until adapters exist. Each dimension has a
score (or none), an evidence class (observed · derived · inferred), a confidence
and provenance rows (source, timestamp, resolution, freshness). The Atlas score
is a weighted mean of the dimensions that have data. One snapshot per cell per
day (`cell_daily`) gives the trend after two days.

`GET /api/cells?bbox&res` scores cells from cached tiles only (no network).
`GET /api/changes?bbox&since` ranks what changed (magnitude × confidence ×
relevance × impact): traffic against its usual, incidents started or cleared,
air against 24 h ago, camera counts, zone events; it lists what cannot be
detected yet (structural change needs OpenStreetMap snapshots over time).


## People's reports (just reported)

People report crimes and unsafe moments through the app (`POST /api/reports`: kind, a few words, a point). The server keeps each report for one day in `crime_reports`, serves them for the view on screen (`GET /api/reports?bbox`), rate-limits a client to ten a day, and pushes a `report` event on the stream so every open map shows the pink callout at once. Every report is shown as a person's report that the app has not verified. No report is ever generated by the app.

## Gentrification (Pro)

See `docs/GENTRIFICATION.md`: the BSOCIAL formulas kept, replaced and dropped; price, rent, liquidity and household figures have no source and are never filled in.
