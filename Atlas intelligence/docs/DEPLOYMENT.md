# Deployment

One process serves everything: the FastAPI server answers `/api/*` and
serves the built web app from `web/dist` with a single-page fallback.

## Environment variables

| name | required | meaning |
|---|---|---|
| `TOMTOM_API_KEY` | for live traffic | TomTom developer key. Never commit it; rotate a key that was ever pasted into a chat. |
| `ANTHROPIC_API_KEY` | for the AI writer | Anthropic API key. Without it the template writer answers. |
| `ATLAS_REGION` | no | `ncr` (the only region so far) |
| `ATLAS_DATA_DIR` | no | where the SQLite cache lives (default `server/data`) |
| `TOMTOM_DAILY_BUDGET` | no | calls per UTC day before the server stops asking TomTom (default 2000) |
| `ATLAS_FIXTURES` | no | folder of recorded responses; runs offline |
| `OVERPASS_URL` | no | another Overpass endpoint |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | for alerts by message | Twilio credentials. Without them alerts show in the app only. |
| `TWILIO_FROM_SMS` | for SMS alerts | the Twilio number, e.g. `+1415…` |
| `TWILIO_FROM_WHATSAPP` | for WhatsApp alerts | the Twilio WhatsApp sender, e.g. `whatsapp:+14155238886` (sandbox) |
| `ATLAS_BASELINE_TILES` | no | flow tiles (`z/x/y`, comma separated) the server keeps reading for the memory even when nobody is watching; default the Connaught Place tile `12/2926/1707` |
| `ATLAS_BASELINE_MINUTES` | no | how often the baseline reader runs (default 10; one tile every 10 minutes is 144 TomTom calls a day) |

## Render (recommended)

1. Push the repository to GitHub.
2. In Render, **New → Blueprint**, pick the repository; `render.yaml` at the
   root defines the service (Python runtime, Node 20 for the web build, a
   2 GB disk for the cache, health check on `/api/health`).
3. Set `TOMTOM_API_KEY` and `ANTHROPIC_API_KEY` in the service's
   environment.
4. Open the service URL: `https://<name>.onrender.com/?region=ncr`.

The web build uses relative asset paths, so the same build works under any
path. Cameras need HTTPS, which Render provides.

## Docker

```bash
docker build -t atlas-infinity .
docker run -p 8000:8000 -e TOMTOM_API_KEY=... -e ANTHROPIC_API_KEY=... -v atlas-data:/var/data atlas-infinity
```

## Outbound hosts the server must reach

- `overpass-api.de` (or your `OVERPASS_URL`)
- `api.tomtom.com`
- `api.open-meteo.com`
- `api.anthropic.com`
- `api.twilio.com` (alerts by WhatsApp or SMS)
- optionally `download.geofabrik.de` for a bulk extract

The browser additionally loads the camera detector from
`cdn.jsdelivr.net` when the camera panel is opened.

## Verifying a live deployment

- `GET /api/health` → `{"ok": true, "tomtom": true, "writer": true}` when both keys are set.
- `GET /api/traffic/status` shows today's TomTom call count.
- In the app: the timeline badge reads `LIVE · TomTom + Open-Meteo + OpenStreetMap`; clicking a main road shows "Live speed … seen · tomtom"; City pulse → Environment shows the weather; the Ask panel shows "written by claude-opus-5-5".

## Static builds

The web app needs the server for every tile and feed; a static build on
its own shows an empty map with "tiles have no map data". Always deploy the
server with the built app in front of it.
