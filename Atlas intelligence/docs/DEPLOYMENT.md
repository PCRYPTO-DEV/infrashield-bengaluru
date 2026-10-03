# Deployment

One process serves everything: the FastAPI server answers `/api/*` and
serves the built web app from `web/dist` with a single-page fallback.

## Environment variables

| name | required | meaning |
|---|---|---|
| `TOMTOM_API_KEY` | for live traffic | TomTom developer key. Never commit it; rotate a key that was ever pasted into a chat. |
| `ANTHROPIC_API_KEY` | for the AI writer | Anthropic API key. Without it the template writer answers. |
| `ATLAS_REGION` | no | `india` (`ncr` still accepted) |
| `OSM_TILES_URL` | no | vector-tile TileJSON or `{z}/{x}/{y}` template (default OpenFreeMap planet); empty disables |
| `ATLAS_WARM_RADIUS` | no | z14 blocks pre-fetched around the origin at startup (default 1) |
| `ATLAS_IPV4_ONLY` | no | `1` (default) binds outbound requests to IPv4 |
| `ATLAS_DATA_DIR` | no | where the SQLite cache lives (default `server/data`) |
| `TOMTOM_DAILY_BUDGET` | no | calls per UTC day before the server stops asking TomTom (default 2000) |
| `ATLAS_FIXTURES` | no | folder of recorded responses; runs offline |
| `OVERPASS_URL` | no | Overpass endpoints, comma separated; each is tried in turn (default: overpass-api.de, then the kumi.systems and private.coffee mirrors) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | for alerts by message | Twilio credentials. Without them alerts show in the app only. |
| `TWILIO_FROM_SMS` | for SMS alerts | the Twilio number, e.g. `+1415…` |
| `TWILIO_FROM_WHATSAPP` | for WhatsApp alerts | the Twilio WhatsApp sender, e.g. `whatsapp:+14155238886` (sandbox) |
| `ATLAS_BASELINE_TILES` | no | flow tiles (`z/x/y`, comma separated) the server keeps reading for the memory even when nobody is watching; default the Connaught Place tile `12/2926/1707` |
| `ATLAS_BASELINE_MINUTES` | no | how often the baseline reader runs (default 10; one tile every 10 minutes is 144 TomTom calls a day) |

## Render (recommended)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/PCRYPTO-DEV/infrashield-bengaluru)

While the code lives in the `Atlas intelligence/` folder of
`PCRYPTO-DEV/infrashield-bengaluru`, a root-level `render.yaml` on the
`atlas-intelligence` branch points Render at that folder (`rootDir`). Steps:

1. In Render, **New → Blueprint**, pick `PCRYPTO-DEV/infrashield-bengaluru`,
   choose branch **atlas-intelligence**, click **Apply**. The blueprint defines
   one web service (Python runtime, Node 20 for the web build, a 2 GB disk for
   the cache, health check on `/api/health`, auto-deploy on push).
2. Render asks for the two secret values: paste `TOMTOM_API_KEY` and
   `ANTHROPIC_API_KEY`. Optional: `TWILIO_*` for alerts by message.
3. Wait for the first build (about 3 to 5 minutes), then open
   `https://atlas-infinity.onrender.com/` (or whatever name Render gave it).
4. Check `https://<name>.onrender.com/api/health` shows `"tomtom": true` and
   `"writer": true`.

When the code moves to its own repository, the `render.yaml` inside this
folder is the one to use (same service, no `rootDir`).

The web build uses relative asset paths, so the same build works under any
path. Cameras need HTTPS, which Render provides.

## Docker

```bash
docker build -t atlas-infinity .
docker run -p 8000:8000 -e TOMTOM_API_KEY=... -e ANTHROPIC_API_KEY=... -v atlas-data:/var/data atlas-infinity
```

## Outbound hosts the server must reach

- `overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee` (or your `OVERPASS_URL` list); also used for the gentrification census and history counts
- `news.google.com` (crime headlines and area mentions, RSS)
- `tiles.openfreemap.org` (OpenStreetMap vector tiles: the fast path for streets anywhere)
- `api.tomtom.com`
- `api.open-meteo.com` and `air-quality-api.open-meteo.com`
- `api.anthropic.com`
- `api.twilio.com` (alerts by WhatsApp or SMS)
- optionally `download.geofabrik.de` for a bulk extract

The browser additionally loads the camera detector from
`cdn.jsdelivr.net` when the camera panel is opened.

## Live without lag

- `GET /api/stream` is a server-sent event stream: every flow tile the server reads, every incident list, camera count and zone event is pushed to every open browser, which fetches the fresh reading at once (the server answers from its cache). Timers are only the fallback.
- The server keeps **hot tiles** (flow tiles viewed in the last 10 minutes) refreshed itself, on an interval that spends at most 60% of what is left of the TomTom daily budget: one hot tile refreshes every 72 s on the free tier, three every 216 s, and so on (`GET /api/live/status` shows the set and the interval). Minute-level refresh across many tiles needs a paid TomTom tier; raise `TOMTOM_DAILY_BUDGET` to match.
- Streets around a chosen state are warmed on the server the moment the state is picked (`GET /api/warm?lng&lat`), and the browser prefetches two rings of tiles beyond the view.

## Verifying a live deployment

- `GET /api/health` → `{"ok": true, "tomtom": true, "writer": true, "osm": {...}}` when both keys are set. `osm.lastError` names the last Overpass failure (and the mirror that failed) when the map stays empty.
- A log line like `401 Unauthorized ... key=ncr` means the value of `TOMTOM_API_KEY` is wrong (here the region id was pasted into the key field). `ATLAS_REGION` takes `ncr`; `TOMTOM_API_KEY` takes the key from developer.tomtom.com.
- The first visit to an area waits on Overpass (a few seconds per tile, two tiles at a time); the app shows "Loading streets from OpenStreetMap… n tiles waiting" until the first tiles land, then "Map data could not be loaded: …" with the server's reason if they never do.
- `GET /api/traffic/status` shows today's TomTom call count.
- In the app: the timeline badge reads `LIVE · TomTom + Open-Meteo + OpenStreetMap`; clicking a main road shows "Live speed … seen · tomtom"; City pulse → Environment shows the weather; the Ask panel shows "written by claude-opus-5-5".

## Static builds

The web app needs the server for every tile and feed; a static build on
its own shows an empty map with "tiles have no map data". Always deploy the
server with the built app in front of it.
