# Shan Shui → Atlas Infinity: architecture study

This document records the study of the two Shan Shui implementations that
Atlas Infinity was asked to transform, what each contributes conceptually, what
code is reusable, what is replaced, and why. It was written *before* the
Atlas Infinity engine code, as the directive requires, and updated once the
replacement was in place.

Sources studied:

| Project | Author | Licence | Form |
|---|---|---|---|
| [shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) | Lingdong Huang (2018) | MIT | One 126 KB `index.html`, ~4,300 lines of JavaScript |
| [shan_shui](https://github.com/Megaemce/shan_shui) | Megaemce (2024) | MIT | React 19 + TypeScript rewrite, OOP, web workers |

## 1. Architecture map

### 1.1 Original (`shan-shui-inf/index.html`)

```
<script id="PRNG">        Prng (Blum–Blum–Shub style: s = s² mod pq), Math.random overridden
<script>                  parseArgs → SEED from ?seed=, Math.seed(SEED)
<script id="PerlinNoise"> Noise.noise(x,y,z) — p5.js value noise port (4 octaves, cosine lerp)
<script id="PolyTools">   midPt, triangulate (ear clipping + sliver optimisation), lineExpr, intersect, ptInPoly
<script>                  helpers: distance, mapval, loopNoise, randChoice, normRand, wtrand, randGaussian, bezmh
                          SVG emitters: poly(), stroke() (noisy variable-width ink), blob(), div()
                          Tree.tree01…08, Mount.mountain/flatMount/distMount, Arch.* (houses, pagodas, boats)
                          water()
                          mountplanner(xmin, xmax)   — the planner
                          MEM { canv, chunks[], xmin, xmax, cwid: 512, cursx, windx, windy, planmtx[] }
                          chunkloader(xmin, xmax)    — extends world in 512 px columns, instantiates plan
                          chunkrender(xmin, xmax)    — concatenates chunk SVG strings within view ± cwid
                          calcViewBox / viewupdate   — pans by rewriting the <svg viewBox>
                          update()                   — chunkloader + chunkrender + innerHTML rewrite
<script id="UI">          xcroll(v), autoxcroll, download(), menu DOM
```

Flow: `xcroll` → `update` → `chunkloader` extends `MEM.xmin/xmax` until the
view (plus one chunk width) is covered → for each new 512 px column
`mountplanner` scans x in steps of 5 and places tagged plan items (`mount`,
`distmount`, `flatmount`, `boat`) using noise local maxima and a 1-D
occupancy matrix (`planmtx`) → each plan item is instantiated to an SVG
string (`canv`) and inserted into `MEM.chunks` sorted by y (painter's
order) → `chunkrender` concatenates the strings of chunks in range →
the whole `<svg>` is rewritten with `innerHTML`.

### 1.2 Refactor (`Megaemce/shan_shui/src`)

```
classes/PRNG.ts          static global PRNG (same s² mod pq), hash via charCode·128^i
classes/Perlin.ts        same p5 noise, table filled from PRNG on first use
classes/Designer.ts      = mountplanner: per range, SketchLayer plan with canFit() AABB collision
classes/Frame.ts         = one generated range; sketchToLayer() instantiates layer classes
classes/Renderer.ts      coveredRange / visibleRange / forwardCoverage; sorts visible layers by
                         tag order then y; stringifies each layer in a *fresh Worker per layer*
classes/Layer.ts         Structure + render() via blob-URL worker (utils/layerWorker.ts)
classes/Element.ts       polyline → SVG string with per-element x range (for culling)
classes/layers/*         BackgroundMountain, MiddleMountain, BottomMountain, Water, Boat
classes/structures/*     trees, rocks, houses, pagodas, towers, boats, men
ui/ScrollableCanvas.tsx  <svg viewBox> + dangerouslySetInnerHTML of the rendered string
App.tsx                  seed from URL or Date.now(); arrow keys / buttons move newPosition
config.ts                every magic number from the original, named
```

The refactor keeps the exact algorithms and adds: range bookkeeping
(`coveredRange`), forward prefetch (`forwardCoverage = innerWidth/2`),
culling of invisible layers, worker-based stringification, dark mode.

## 2. Findings by directive item

| # | Item | Finding |
|---|---|---|
| 3 | Reusable algorithms | **Plan → instantiate → cache → cull** pipeline; AABB collision placement (`canFit`); noise-driven density fields for placement; noisy variable-width ink stroke (`stroke()`) and stipple textures as a visual device; ear-clipping triangulation (not needed by Atlas Infinity). |
| 4 | Rendering logic | Everything is an SVG *string*. Geometry is stringified once per chunk and never re-projected; panning rewrites only the root `viewBox`. The refactor adds per-layer `<g>` grouping and visibility culling. |
| 5 | Procedural generation | Two-level grammar: *planner* decides what goes where (tags, x, y, h) from noise; *generators* (`Mount.mountain`, `Tree.tree0x`, `Arch.*`) turn a plan item into geometry using fractal/noise recursion. |
| 6 | Seed handling | A single global PRNG seeded from `?seed=` (or `Date.now()`); `Math.random` is overridden. Deterministic **only** if every call happens in the same order: generating chunk B before chunk A changes both. The refactor inherits this (static `PRNG.seed`). |
| 7 | Chunk / world generation | 1-D only (x). Chunk width 512 px. The world grows outward from 0; `MEM.xmin/xmax` track the covered range. Chunks are never unloaded. |
| 8 | Viewport | `MEM.cursx` + `windx`; `calcViewBox()` applies a fixed 1.142 zoom; no real zoom, no y. |
| 9 | SVG generation | `poly()`/`stroke()`/`blob()` build `<polyline>` strings; `update()` rewrites the entire `<svg>` via `innerHTML` on every scroll. |
| 10 | Noise | p5.js `noise.js` port: value noise with cosine interpolation, 4 octaves, falloff 0.5, 4096-entry table seeded from the PRNG. |
| 11 | Geometry primitives | `[x, y]` arrays; `PolyTools` (midpoint, triangulate, intersect, point-in-polygon); `bezmh` (Bézier through midpoints); `div()` subdivision. |
| 12 | Performance bottlenecks | (a) whole-document `innerHTML` rewrite per scroll; (b) no unloading → unbounded DOM/memory; (c) `mountplanner` re-scans with `xstep = 5`; (d) `Math.random` override makes every call a closure invocation; (e) refactor spawns and terminates one Worker **per layer per render** (worker start-up dominates); (f) `feTurbulence` paper filter over the full viewport is expensive on large screens. |
| 13 | Must not be reused | Global PRNG / `Math.random` override (order-dependent determinism); 1-D chunk model; whole-DOM rewrite; p5-derived noise verbatim (LGPL-2.1 lineage, see §4); all landscape-specific generators (mountains, trees, boats, pagodas, water); the per-layer worker spawn pattern; the `Date.now()` default seed. |
| 14 | Licences | Both projects: MIT. Attribution preserved in `cityatlas/THIRD_PARTY_NOTICES.md`. The noise code inside Shan Shui is a port of p5.js (LGPL-2.1); Atlas Infinity does not reuse it (§4). |

## 3. What Atlas Infinity keeps (conceptually) and how

| Shan Shui concept | Atlas Infinity equivalent |
|---|---|
| `mountplanner` plan → instantiate | `engine/procedural/grammar/*` (roads → blocks → buildings/parks/transit → signals → incidents) inside `generateChunk()` |
| `MEM.chunks` + `chunkloader` + `chunkrender` | `engine/chunks/CityChunkManager` (2-D tiles, priority, cancellation, LRU unload) |
| `canv` string per chunk | `ChunkData.svg[lod]` — three pre-built strings per chunk; renderer swaps `<g>` content |
| `viewBox` panning | `rendering/svg/StaticSvgRenderer` sets only the root `viewBox` per frame |
| noise-driven placement fields | `engine/procedural/grammar/blocks.ts` `createCityFields` (density, commercial, green) |
| noisy ink stroke / stipple | park stipple and building hatch in `rendering/svg/chunkSvg.ts` |
| `?seed=` URL | `atlas://world/{seed}` via `?world=` |
| Worker stringification | Generation **and** stringification happen in a persistent worker pool (`workers/worldGeneration.worker.ts`) |
| `Designer.canFit` collisions | not needed: the street grid is a partition, so blocks never overlap by construction |

## 4. What is replaced, and why

1. **Seeding.** Replaced by `engine/seed/*`: FNV-1a/mix hashing, mulberry32
   PRNG instances, and `worldSeed({globalSeed, tileId, simulationTime,
   datasetVersion, stream})`. Every chunk, every grammar stage, every
   agent owns its own stream. Generating tiles in any order yields
   byte-identical output (tested).
2. **Noise.** Re-implemented Ken Perlin's 2002 improved gradient noise
   (public-domain reference algorithm) with a seeded permutation table.
   Avoids carrying p5.js's LGPL lineage into an MIT code base and gives
   smoother gradients than value noise.
3. **Chunks.** 1-D 512 px columns become Web Mercator XYZ tiles: zoom 16
   for the street tier (~600 m) and zoom 13 for the district tier. Tiles
   are geographically anchored, so the same tile id maps to the same place
   on Earth and later to real OSM data.
4. **Cross-chunk continuity.** Shan Shui had no continuity problem (mountains
   do not need to join). Roads do. Vertical street positions are a pure
   function of the tile *column*, horizontal ones of the tile *row*, and
   edge roads are split at the union of both neighbours' interior lines, so
   adjacent tiles share graph nodes without any communication.
5. **Rendering.** Static geometry stays SVG (one `<g>` per chunk, swapped on
   LOD change only). Moving objects go to Canvas 2D with a single transform.
   React renders UI only.
6. **Time and simulation.** Shan Shui is timeless. Atlas Infinity adds a
   `TemporalEngine`, a deterministic `MovementEngine` in a worker, a replay
   recorder, and incident grammar keyed by (tile, hour bucket).
7. **Evidence.** Every entity carries `EvidenceMetadata`; renderers style by
   classification, never by source.

## 5. Risks carried forward

- The grammar is a grid city. It is honest about being synthetic and is
  designed so real OSM roads can replace it tile by tile through the same
  `ChunkData` contract, but it does not yet imitate organic street patterns.
- Per-chunk SVG strings are large at street LOD (~60–120 KB). The chunk
  budget keeps the DOM bounded; a WebGL static tier is the next step if the
  budget proves too low on weak hardware.
