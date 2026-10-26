# RuView sensing-server API

Source: github.com/ruvnet/RuView, commit `3686bc7` (2026-10-26), `docs/user-guide.md` and
`v2/crates/wifi-densepose-sensing-server/src/bearer_auth.rs`.

Base URL: `http://localhost:3000` (Docker) or `http://localhost:8080` (native binary default).
Auth: when `RUVIEW_API_TOKEN` is set on the server, every `/api/v1/*` request needs
`Authorization: Bearer <token>`. `/health*`, `/`, `/ui/*` and `/ws/sensing` are anonymous.

## Read

| Endpoint | Returns |
|---|---|
| `GET /health` | `{"status":"ok","source":"simulated|esp32|…","clients":N}` |
| `GET /api/v1/info` | version, build, uptime |
| `GET /api/v1/sensing/latest` | latest CSI frame (amplitude, phase, motion) |
| `GET /api/v1/vital-signs` | `breathing_bpm`, `heart_bpm`, `breathing_confidence`, `heart_confidence`, `motion_level`, `timestamp_ms` |
| `GET /api/v1/pose/current` | `persons[{id, keypoints[{name,x,y,z,confidence}]}]`, `frame_id`, `timestamp_ms` |
| `GET /api/v1/nodes` | connected CSI nodes |
| `GET /api/v1/mesh` | `{"nodes":{id:{offset_us,is_leader,is_valid,csi_fps_ema,…}},"total":N}` |
| `GET /api/v1/nodes/:id/sync` | one node's sync snapshot. 404 `unknown_node` or `no_sync` |
| `GET /api/v1/mesh/metrics` | Prometheus text |
| `GET /api/v1/bssid` | multi-BSSID registry (neighbour APs) |
| `GET /api/field` | latest signed RuField events (only egress-safe P1/P2). Plumbing, not an accuracy claim |

## Models and training

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/models`, `GET /api/v1/models/active` | list / current RVF model |
| `POST /api/v1/models/load` `{model_id}`, `POST /api/v1/models/unload`, `DELETE /api/v1/models/:id` | manage models |
| `GET /api/v1/models/lora/profiles`, `POST /api/v1/models/lora/activate` | LoRA adapters |
| `GET /api/v1/model/layers`, `GET /api/v1/model/sona/profiles`, `POST /api/v1/model/sona/activate` `{profile}` | progressive loading, per-room SONA profiles |
| `GET /api/v1/train/status`, `POST /api/v1/train/start`, `POST /api/v1/train/stop` | training runs |
| `POST /api/v1/adaptive/train`, `GET /api/v1/adaptive/status`, `POST /api/v1/adaptive/unload` | adaptive classifier from recordings |

## Recording

`GET /api/v1/recording/list`, `POST /api/v1/recording/start`, `POST /api/v1/recording/stop`,
`DELETE /api/v1/recording/:id`. Files go to `<data-dir>/recordings/` (`RUVIEW_DATA_DIR`, default `data`).

## Streaming

- `ws://localhost:3000/ws/sensing` (also on the dedicated WebSocket port 3001). JSON per update, with
  `persons`, `vital_signs`, and a per-node `sync` on mesh firmware v0.7.0+.
- `ws://…/ws/field`: signed RuField events.
- Python: `pip install "ruview[client]"`, then `from ruview.client import SensingClient, EdgeVitalsMessage`.

## Server environment (Docker)

| Variable | Effect |
|---|---|
| `RUVIEW_API_TOKEN` | **Required.** Without it, or `RUVIEW_ALLOW_UNAUTHENTICATED=1`, the container exits 64. |
| `CSI_SOURCE` | `auto` (default), `esp32`, `simulated`, `wifi` (host RSSI, not in containers) |
| `RUVIEW_UDP_ALLOW=<ip-or-cidr>` | accept ESP32 UDP frames only from these sources (preferred) |
| `RUVIEW_UDP_INSECURE_LAN=true` | accept from anyone. The UDP plane is unauthenticated, so only use this on trusted networks. |
| `RUVIEW_UDP_BIND` | explicit UDP bind address |
| `SENSING_ALLOWED_HOSTS=<host-ip>` | needed to open the UI from another machine (else 421) |
| `RUVIEW_DATA_DIR`, `MODELS_DIR` | data / model locations |
| `WDP_RUFIELD_SIGNING_SEED` | signing key for `/api/field`. The default is a dev key, so set it for real deployments. |

Native binary equivalents: `--source esp32 --udp-port 5005 --http-port 3000 --ws-port 3001
--udp-bind 0.0.0.0 --udp-allow <cidr>` (or `--udp-insecure-lan`).
