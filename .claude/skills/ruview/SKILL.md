---
name: ruview
description: Set up and use RuView (github.com/ruvnet/RuView, a.k.a. WiFi-DensePose), the open-source WiFi sensing platform that turns WiFi Channel State Information (CSI) from cheap ESP32-S3 boards into presence/occupancy, breathing and heart-rate estimates, activity/fall detection and experimental 17-keypoint pose, without cameras. Use when the user mentions RuView or WiFi-DensePose, wants camera-free presence, occupancy or vital-sign sensing, wants to flash/provision ESP32 CSI nodes, or wants to read RuView's REST/WebSocket data (vitals, pose, nodes, recordings, models) into another program.
---

# RuView: WiFi sensing

People moving, breathing or just sitting disturb WiFi signals in measurable ways. RuView captures
those disturbances as CSI from ESP32 boards (about $9 each) and runs signal processing and small
models on them. A Rust **sensing server** (Docker image `ruvnet/wifi-densepose`) collects the data
and serves a dashboard, a REST API and WebSocket streams. This skill sets that server up and
reads data from it with `scripts/ruview.py` (Python 3.9+, standard library only).

## Be honest about what it can do

RuView is **beta**. Say this up front, and don't overstate results:

| Capability | Status |
|---|---|
| Presence / motion / occupancy | Works with CSI hardware. A single node has coarse spatial resolution, so use 2+ nodes. |
| Breathing and heart rate | Heuristic. **Not validated and not medical-grade.** Never present it as a diagnosis. |
| 17-keypoint pose from WiFi only | **First-cut.** About 2.5% PCK@20 with proxy labels. The dashboard skeleton in simulated mode is a demo. |
| Through-wall | Presence and activity only, about ≤5 m. |
| Laptop WiFi (no ESP32) | RSSI only: coarse presence and motion, no vitals or pose. |
| ESP32-C3 / original ESP32 | **Not supported** (single core). Use ESP32-S3 or ESP32-C6. |

**Privacy:** this senses people through walls. Only deploy it in spaces the user controls, and with
the knowledge of the people being sensed.

## 1. Pick a path

- **No hardware** → Docker with simulated data (below). Good for demos and API integration.
- **ESP32-S3 boards** → flash firmware, provision WiFi, run the server with `CSI_SOURCE=esp32`.
  See `reference/hardware.md`.
- **Python only** → `pip install ruview` (or `"ruview[client]"` for the WebSocket and MQTT clients).
  Imports: `from ruview import BreathingExtractor, HeartRateExtractor`.

## 2. Start the sensing server (Docker)

The container **exits with code 64 unless `RUVIEW_API_TOKEN` is set.** Keep the token and reuse it
for API calls.

```bash
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
docker run -d --name ruview -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 \
  -e RUVIEW_API_TOKEN ruvnet/wifi-densepose:latest
# Dashboard: http://localhost:3000
```

With real ESP32 nodes, also add `-p 5005:5005/udp -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW=<node-ip-or-cidr>`.
Without a UDP allowlist the server starts but **no node ever appears**, which is the most common
problem. On macOS Docker Desktop, allow the Docker bridge gateway instead of the LAN subnet. The
exact command is in `reference/hardware.md`.

`CSI_SOURCE` can be `auto` (default: tries the ESP32, falls back to simulated data), `esp32`,
`simulated` or `wifi`. `wifi` is host RSSI and does not work inside a container.

## 3. Read data

```bash
python scripts/ruview.py health              # no token needed; shows source=simulated|esp32
python scripts/ruview.py info
python scripts/ruview.py vitals              # breathing_bpm, heart_bpm, confidences
python scripts/ruview.py pose                # persons[].keypoints (17 COCO joints)
python scripts/ruview.py nodes               # connected CSI nodes
python scripts/ruview.py watch --seconds 60  # poll vitals; prints one line per sample
python scripts/ruview.py record start --name kitchen --label empty --duration 60   # CSI to JSONL, for training
python scripts/ruview.py record stop
python scripts/ruview.py get /api/v1/models  # any GET endpoint
```

The script reads `RUVIEW_URL` (default `http://localhost:3000`) and `RUVIEW_API_TOKEN` from the
environment. Every `/api/v1/*` call needs that token (`401` means it is missing or wrong).
`/health`, `/ws/sensing` and the dashboard do not need it.

For live streaming, use the WebSocket at `ws://localhost:3000/ws/sensing`. Each message has
`persons` and `vital_signs`. Python: `ruview.client.SensingClient`, or the `websockets` package.
All endpoints are listed in `reference/api.md`.

Always check `source` in `health`. If it says `simulated`, the numbers are synthetic, and
you must say so.

## 4. Going deeper

RuView ships its own Claude Code plugin with deeper workflows (firmware builds, model training,
multistatic mesh, witness verification). Install it when the user wants that level:

```
/plugin marketplace add ruvnet/RuView
/plugin install ruview@ruview
```

Note: that plugin auto-starts an unpinned `npx -y @ruvnet/rvagent` MCP server, and its skills
pre-approve Bash/Write/Edit. Mention this before installing. Its docs also hard-code its author's
Windows paths and COM ports, so adapt those.

Other upstream docs (in a clone of the repo): `docs/user-guide.md` (everything),
`docs/TROUBLESHOOTING.md`, `docs/wifi-mat-user-guide.md` (search-and-rescue mode),
`firmware/esp32-csi-node/README.md`. To check that the signal pipeline is intact without hardware,
run `python archive/v1/data/proof/verify.py` in a clone. It must print `VERDICT: PASS`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Container exits immediately (code 64) | `RUVIEW_API_TOKEN` not set or not passed with `-e RUVIEW_API_TOKEN`. |
| `401` on `/api/v1/...` | Export the same token in the shell running `ruview.py`. |
| `421` when opening UI from another machine | Set `SENSING_ALLOWED_HOSTS=<host-ip>` and publish the ports beyond `127.0.0.1`. |
| Server up, no ESP32 nodes | Missing `RUVIEW_UDP_ALLOW`, or UDP 5005 not published, or the node was provisioned with the wrong `--target-ip`. On macOS, allow the gateway. |
| False fall alerts | Old firmware threshold. Reflash the latest release, or raise `--fall-thresh`. |
| Native binary on :8080 instead of :3000 | Pass `--base-url http://localhost:8080` or set `RUVIEW_URL`. |

License: RuView is MIT. Parts of this skill are adapted from its plugin (see `NOTICE.md`).
