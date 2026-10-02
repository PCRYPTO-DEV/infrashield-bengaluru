# Data sources

| source | what | how it enters | class | cache | cost |
|---|---|---|---|---|---|
| OpenStreetMap (Overpass API) | roads, buildings, signals, transit, parks, place names | server `/api/tiles/osm/{z}/{x}/{y}.json`, tiers `street` (z16) and `district` (z13) | observed | SQLite, 30 days | free; the public Overpass server is rate-limited, so the server sends at most 1 request/s |
| TomTom Traffic Flow (vector tiles, `relative0`) | current speed ÷ free-flow speed per road segment | `/api/traffic/flow/{z}/{x}/{y}` at zoom 12, decoded server-side | observed | 120 s per tile | counts against the daily budget |
| TomTom Incident Details v5 | accidents, road works, closures, jams, with start and end times | `/api/traffic/incidents?bbox=` | observed | 60 s | counts against the daily budget |
| Open-Meteo | temperature, humidity, rain, wind, weather code | `/api/weather?lat&lng` | observed | 10 min | free, no key |
| Phone or laptop camera | people and vehicles as tracked dots | in the browser only; never uploaded | observed | none | free |
| Uploaded files | GeoJSON, JSON records, CSV with lat/lng, ≤ 10 MB | parsed and validated in the browser | observed | none | free |
| The simulation | cars, people, incidents where no feed covers | generation and simulation workers | simulated | n/a | free |
| Anthropic API | plain-words answers | `/api/explain`, `/api/ask` | rephrases only; never a source of facts | prompt cache | per token |

## TomTom budget

The free tier allows 2,500 requests per day. The server keeps a counter per
UTC day in its cache and refuses new calls past `TOMTOM_DAILY_BUDGET`
(default 2,000), answering 429 so the app shows "traffic is simulated" for
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
segment, an edge keeps the simulation's level and stays `simulated`.
