# Doctor Maps

Doctor Maps is an AI agent that builds things inside QGIS. You describe what you want in plain language and it does the work in your live QGIS session: loading and cleaning data, running Processing algorithms, styling and labelling layers, building print layouts, exporting results, and anything else PyQGIS can do.

It is a single Python package that works three ways:

| Mode | What you get | How |
|---|---|---|
| **QGIS plugin** | A chat dock inside QGIS. Results appear on the canvas as the agent works, including the map images it renders to check its own work. | Copy or symlink the `doctor_maps` folder into the QGIS plugins directory and enable it. |
| **Terminal + QGIS desktop (bridge)** | Run `doctor-maps` in a terminal; the agent drives the QGIS window that has the plugin enabled. | Plugin enabled with "Allow terminal connections" on, then `doctor-maps` from any shell. |
| **Terminal, headless** | No QGIS window at all: a standalone QgsApplication runs in-process. Good for scripts, servers and CI. | Run with the Python that ships with QGIS. |

## How it works

The agent is a Claude tool-use loop (`doctor_maps/agent.py`). Claude gets ten tools, all executed in QGIS:

- `run_pyqgis` runs arbitrary Python in the session with `qgis.core`, `processing`, `project` and `iface` pre-imported. Variables persist between calls. This is what makes "anything" possible.
- `project_summary`, `list_layers`, `describe_layer` for inspecting data before acting.
- `load_layer` for vector, raster, CSV-with-coordinates and provider URIs (XYZ tiles, WMS, WFS, PostGIS).
- `search_algorithms`, `describe_algorithm`, `run_algorithm` for the Processing toolbox; layer parameters accept layer names.
- `render_map` returns a PNG to Claude so it can look at what it built.
- `save_project`.

The loop streams responses, validates every tool input before running it, echoes thinking blocks back unchanged, caches the static system prompt, and turns on server-side refusal fallbacks by default. Every tool call and result is shown in the UI, and an optional confirmation gate asks before code runs.

`doctor_maps/qgis_runtime.py` holds every line that touches PyQGIS; `doctor_maps/bridge.py` is the localhost link between a terminal and QGIS desktop (token-authenticated, 127.0.0.1 only); `doctor_maps/plugin/` is the Qt dock and the main-thread marshalling.

## Setup

1. An Anthropic API key, exported as `ANTHROPIC_API_KEY` (or sign in once with `ant auth login`). The plugin can also ask for the key and remember it in QGIS settings.
2. The Anthropic SDK in the Python that will run the agent:

   ```bash
   pip install anthropic          # terminal use
   ```

   For the plugin the SDK must be in QGIS's own Python:

   - Windows: open the *OSGeo4W Shell* and run `python -m pip install anthropic`
   - macOS: `/Applications/QGIS.app/Contents/MacOS/bin/python3 -m pip install anthropic`
   - Linux: `python3 -m pip install --user anthropic` (the system Python QGIS uses)

   The dock also offers a "Try to install it now" button.

3. For terminal use, install the package:

   ```bash
   pip install -e .               # from the repository root; gives you the `doctor-maps` command
   ```

### Installing the plugin

Copy (or symlink) the `doctor_maps` folder into your QGIS profile's plugin directory:

- Windows: `%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\doctor_maps`
- macOS: `~/Library/Application Support/QGIS/QGIS3/profiles/default/python/plugins/doctor_maps`
- Linux: `~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/doctor_maps`

Then in QGIS: *Plugins > Manage and Install Plugins > Installed*, tick **Doctor Maps**. A toolbar button and a *Plugins > Doctor Maps* menu appear.

## Using it

### In the QGIS dock

Click the Doctor Maps toolbar button and type a request:

> Load backend/data/bengaluru_facilities_seed.csv and the risk zones GeoJSON, buffer hospitals by 1 km, count how many buffers intersect a High severity flood zone, and style the facilities by criticality_score with a 5-class Viridis ramp.

The dock shows every tool call, errors the agent fixes, the maps it renders, and the final summary. *Stop* ends the run after the current step. *New conversation* clears the history (layers stay). *Confirm before running code* shows each `run_pyqgis` / `run_algorithm` call before it runs.

### From a terminal, driving QGIS desktop

With QGIS open and the plugin enabled:

```bash
doctor-maps                                   # interactive session
doctor-maps "add an OSM basemap and zoom to the facilities layer"
doctor-maps --confirm                         # approve each code block first
```

The CLI finds the bridge through `~/.doctor_maps/bridge.json`. Turn the bridge off in *Plugins > Doctor Maps > Allow terminal connections*.

### Headless

```bash
/usr/bin/python3 -m doctor_maps --headless --project city.qgz "export a PDF map of flood zones with a legend"
/usr/bin/python3 -m doctor_maps --headless --load data/roads.gpkg --output-dir out "make a 2 km buffer of motorways as GeoPackage"
```

Use the Python that can `import qgis` (OSGeo4W Shell on Windows, the QGIS.app Python on macOS, the system Python on Linux).

Interactive commands: `/layers`, `/render [path]`, `/save [path]`, `/reset`, `/usage`, `/quit`.

### Options and environment

| Flag | Env var | Default | Meaning |
|---|---|---|---|
| `--model` | `DOCTOR_MAPS_MODEL` | `claude-opus-5-5` | Model id |
| `--effort` | `DOCTOR_MAPS_EFFORT` | `high` | `low` / `medium` / `high` / `xhigh` / `max` |
| `--no-fallbacks` | `DOCTOR_MAPS_FALLBACKS=0` | fallbacks on | Server-side refusal fallbacks |
| `--show-thinking` | | off | Print summarised reasoning |
| `--confirm` | | off | Approve code before it runs |
| | `DOCTOR_MAPS_HOME` | `~/.doctor_maps` | Where the bridge discovery file lives |

## Library use

```python
from doctor_maps.agent import DoctorMapsAgent
from doctor_maps.qgis_runtime import QgisRuntime
from doctor_maps.tools import LocalExecutor

runtime = QgisRuntime.headless(output_dir="out")
runtime.load_layer("data/facilities.csv")
agent = DoctorMapsAgent(LocalExecutor(runtime), on_event=lambda e: print(e.kind, str(e.data)[:80]))
print(agent.ask("Cluster the facilities with DBSCAN and colour each cluster", context=runtime.project_summary()))
runtime.close()
```

## Safety notes

- `run_pyqgis` executes code generated by the model inside QGIS with your user's permissions. The system prompt tells the agent to write only under the project or output folder and never to delete source data, and the confirmation toggle lets you review every code block. Treat it like a capable colleague with console access, not a sandbox.
- The bridge listens on `127.0.0.1` only and requires a random token stored in a `0600` file. Anything that can read that file can drive your QGIS session.
- API keys saved through the dock are stored unencrypted in QGIS settings; prefer the `ANTHROPIC_API_KEY` environment variable on shared machines.

## Development

```bash
pip install -e ".[dev]"
pytest                                  # agent loop, tools, bridge (no QGIS needed)
/usr/bin/python3 -m pytest tests/        # adds the real-QGIS runtime tests when PyQGIS is importable
```

The agent tests use a scripted fake client, so no API key or network is needed. The QGIS tests start a headless QgsApplication and exercise every tool against the repository's seed data.
