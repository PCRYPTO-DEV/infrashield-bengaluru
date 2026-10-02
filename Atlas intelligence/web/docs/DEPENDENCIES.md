# Dependencies

Principle: no dependency that the engine could reasonably own. Each entry
says why it exists and what would have to be true to remove it.

## Runtime

| package | version | why |
|---|---|---|
| `react`, `react-dom` | 18.3 | Application UI only (panels, timeline, inspector). The city itself is rendered imperatively (SVG + Canvas); React never holds a city object. Chosen over no framework because the directive asks for React and the panels benefit from it. |

That is the entire runtime dependency list. The production bundle is ~250 KB
(80 KB gzipped) including React.

## Development

| package | why |
|---|---|
| `vite` 5 | dev server, bundler, native `new Worker(new URL(...), {type:'module'})` support |
| `@vitejs/plugin-react` | JSX transform / fast refresh |
| `typescript` 5.5 | strict mode everywhere; `noUnusedLocals` |
| `vitest` 2 | tests; runs the engine in Node without a DOM |
| `@types/react`, `@types/react-dom` | types |

## Deliberately not (yet) depended on

| candidate | decision |
|---|---|
| **MapLibre GL JS** | Not in the MVP. The demo city is synthetic and renders through its own SVG/Canvas tiers, which is what gives it a visual identity rather than a basemap. The geo layer (`geo/projection`, `geo/tiles`) is Web Mercator XYZ so a MapLibre basemap can be slotted *under* the SVG tier for real regions without touching the engine. |
| **Turf.js** | Not needed: point-in-polygon, polyline distance, haversine, bounds and buffering are ~150 lines in `geo/geometry.ts` and `zones/geometry.ts`. Add Turf only if a real GIS operation (union, difference, simplification) is required. |
| **GeoJSON types (`@types/geojson`)** | A minimal local definition in `geo/geojson.ts` avoids a types-only dependency. |
| **IndexedDB wrapper** | Chunk caching is in memory with a budget; persisting chunks is unnecessary because generation is deterministic and ~10–20 ms per tile. IndexedDB belongs to the uploaded-dataset and OSM adapters when offline caching is wanted. |
| **ONNX Runtime Web / TensorFlow.js (COCO-SSD)** | Heavy. `cv/detectors` exposes `ObjectDetector` adapters that take an injected model loader, so either library can be dynamically imported by the host app without being bundled or required by tests. |
| **Web Worker frameworks (comlink)** | Two message types per worker; a hand-written protocol is smaller and transferables are explicit. |
| **State libraries** | `useSyncExternalStore` against a version counter on `CityAtlas` is sufficient. |

## Network endpoints the code can talk to

- `https://overpass-api.de/api/interpreter` — only when `OpenStreetMapAdapter` is used explicitly. The demo makes no network calls.
