"""OpenStreetMap tiles via Overpass, normalised to Atlas Infinity UrbanEntities.

The normalisation mirrors web/src/data/adapters/openStreetMapAdapter.ts
(normalizeOsm) so the browser receives entities it already understands.
Every entity is `observed · openstreetmap`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import socket
import time
from pathlib import Path
from typing import Any

import httpx

from .cache import Cache
from .config import settings
from .tiles import BBox, lnglat_to_tile, tile_bbox
from .vtiles import VectorTileSource

HIGHWAY_CLASS = {
    "motorway": "arterial", "trunk": "arterial", "primary": "arterial",
    "secondary": "collector", "tertiary": "collector",
    "residential": "local", "unclassified": "local", "living_street": "local", "service": "service",
    "motorway_link": "collector", "trunk_link": "collector", "primary_link": "collector", "secondary_link": "local",
}
MAXSPEED_DEFAULT = {"arterial": 13.9, "collector": 11.1, "local": 8.3, "service": 5.5}
TILE_TTL = 30 * 24 * 3600
log = logging.getLogger("atlas.osm")
# One Overpass query covers a whole block of tiles (z14 for street tiles: 16 of them; z11 for district
# tiles: 16 of those), and every tile in the block is cached from that one answer. A screen that needs
# 40 street tiles then costs 3 or 4 queries instead of 40.
BLOCK_ZOOM = {"street": 14, "district": 13}
# How long a mirror that failed is skipped before it is tried again.
DOWN_SECONDS = 60.0

STREET_QUERY = (
    '[out:json][timeout:25];('
    'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|motorway_link|trunk_link|primary_link|secondary_link)$"]({bbox});'
    'way["building"]({bbox});'
    'node["highway"="traffic_signals"]({bbox});'
    'node["public_transport"="station"]({bbox});'
    'node["railway"="station"]({bbox});'
    'way["leisure"~"^(park|garden|nature_reserve|playground|pitch)$"]({bbox});'
    'way["landuse"~"^(grass|forest|recreation_ground|village_green|orchard|meadow|cemetery)$"]({bbox});'
    'way["natural"~"^(wood|scrub|grassland|heath)$"]({bbox});'
    'node["natural"="tree"]({bbox});'
    ');out geom;'
)
GREEN_KINDS = {"park", "garden", "nature_reserve", "playground", "pitch", "grass", "forest", "recreation_ground", "village_green", "orchard", "meadow", "cemetery", "wood", "scrub", "grassland", "heath"}
MAJOR_QUERY = (
    '[out:json][timeout:25];('
    'way["highway"~"^(motorway|trunk|primary|secondary)$"]({bbox});'
    'node["place"~"^(suburb|neighbourhood|town|city)$"]({bbox});'
    ');out geom;'
)


def parse_maxspeed(v: str | None) -> float | None:
    if not v:
        return None
    import re
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(mph)?", v)
    if not m:
        return None
    n = float(m.group(1))
    return n * 0.44704 if m.group(2) else n / 3.6


def land_use(tags: dict[str, str]) -> str:
    b = tags.get("building")
    if b == "office" or "office" in tags:
        return "office"
    if b in ("commercial", "retail") or "shop" in tags:
        return "commercial"
    if b in ("industrial", "warehouse"):
        return "industrial"
    if b in ("school", "hospital", "public", "civic") or "amenity" in tags:
        return "civic"
    if b in ("apartments", "house", "residential", "yes"):
        return "residential"
    return "mixed"


def close_ring(coords: list[list[float]]) -> list[list[float]]:
    return coords if coords and coords[0] == coords[-1] else coords + [coords[0]]


def normalize(elements: list[dict[str, Any]], fetched_at: float) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    ts = int(fetched_at * 1000)

    def ev(conf: float = 0.9) -> dict[str, Any]:
        return {"classification": "observed", "source": "openstreetmap", "timestamp": ts, "confidence": conf}

    for el in elements:
        tags = el.get("tags") or {}
        t = el.get("type")
        if t == "node" and "lat" in el:
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
            if tags.get("highway") == "traffic_signals":
                out.append({"id": f"osm:n{el['id']}", "type": "traffic_signal", "geometry": geom, "evidence": ev(),
                            "properties": {"nodeId": f"osm:n{el['id']}", "cycleSeconds": 0, "offsetSeconds": 0, "greenNorthSouthSeconds": 0, "osm": tags}})
            elif tags.get("public_transport") == "station" or tags.get("railway") == "station":
                mode = "metro" if tags.get("station") == "subway" or tags.get("subway") == "yes" else ("rail" if "railway" in tags else "bus")
                out.append({"id": f"osm:n{el['id']}", "type": "transit", "geometry": geom, "evidence": ev(),
                            "properties": {"name": tags.get("name", "Station"), "mode": mode, "osm": tags}})
            elif tags.get("atlas:poi"):
                out.append({"id": f"osm:n{el['id']}", "type": "poi", "geometry": geom, "evidence": ev(),
                            "properties": {"kind": tags["atlas:poi"], "name": tags.get("name") or tags["atlas:poi"], "osm": tags}})
            elif tags.get("natural") == "tree":
                out.append({"id": f"osm:n{el['id']}", "type": "tree", "geometry": geom, "evidence": ev(),
                            "properties": {"name": tags.get("name"), "species": tags.get("species") or tags.get("genus"), "osm": tags}})
            elif tags.get("place"):
                out.append({"id": f"osm:n{el['id']}", "type": "zone", "geometry": geom, "evidence": ev(),
                            "properties": {"name": tags.get("name", tags["place"]), "restricted": False, "place": tags["place"]}})
            continue
        if t == "way" and el.get("geometry") and len(el["geometry"]) >= 2:
            coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
            if tags.get("highway") in ("footway", "path", "pedestrian", "steps", "cycleway", "living_street_path"):
                out.append({"id": f"osm:w{el['id']}", "type": "path", "geometry": {"type": "LineString", "coordinates": coords}, "evidence": ev(),
                            "properties": {"kind": tags["highway"], "name": tags.get("name"), "osm": tags}})
            elif "highway" in tags:
                cls = HIGHWAY_CLASS.get(tags["highway"], "local")
                ms = parse_maxspeed(tags.get("maxspeed"))
                try:
                    lanes = int(tags.get("lanes", ""))
                except ValueError:
                    lanes = 2 if cls == "arterial" else 1
                out.append({"id": f"osm:w{el['id']}", "type": "road", "geometry": {"type": "LineString", "coordinates": coords},
                            "evidence": ev(0.9 if ms else 0.75),
                            "properties": {"name": tags.get("name", tags["highway"]), "roadClass": cls, "lanes": lanes,
                                           "oneway": tags.get("oneway") == "yes", "speedLimit": ms or MAXSPEED_DEFAULT[cls],
                                           "speedLimitSource": "osm:maxspeed" if ms else "class-default", "edgeIds": [], "osm": tags}})
            elif "building" in tags:
                try:
                    levels = int(tags.get("building:levels", ""))
                except ValueError:
                    levels = None
                try:
                    height = float(str(tags.get("height", "")).split()[0])
                except (ValueError, IndexError):
                    height = None
                floors = levels if levels else (max(1, round(height / 3.2)) if height else 1)
                out.append({"id": f"osm:w{el['id']}", "type": "building", "geometry": {"type": "Polygon", "coordinates": [close_ring(coords)]},
                            "evidence": ev(0.9 if (levels or height) else 0.7),
                            "properties": {"landUse": land_use(tags), "floors": floors, "heightM": height or floors * 3.2, "footprintM2": 0,
                                           "name": tags.get("name"), "floorsSource": "osm:building:levels" if levels else ("osm:height" if height else "assumed"), "osm": tags}})
            else:
                kind = next((tags[k] for k in ("leisure", "landuse", "natural") if tags.get(k) in GREEN_KINDS), None)
                if kind:
                    out.append({"id": f"osm:w{el['id']}", "type": "park", "geometry": {"type": "Polygon", "coordinates": [close_ring(coords)]},
                                "evidence": ev(), "properties": {"name": tags.get("name", kind.replace("_", " ")), "kind": kind, "areaM2": 0, "osm": tags}})
    return out


def http_client(timeout: httpx.Timeout) -> httpx.AsyncClient:
    """An httpx client that binds to IPv4 when ATLAS_IPV4_ONLY is set (the default)."""
    transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0") if settings.ipv4_only else None
    return httpx.AsyncClient(timeout=timeout, transport=transport, headers={"User-Agent": "atlas-infinity/0.2 (OpenStreetMap data for a live city map)"})


HIGHWAYS = set(HIGHWAY_CLASS)


def wanted(tags: dict[str, str], tier: str) -> bool:
    """The same selection the Overpass queries make, applied to raw map-API elements."""
    if tier == "district":
        return tags.get("highway") in ("motorway", "trunk", "primary", "secondary") or tags.get("place") in ("suburb", "neighbourhood", "town", "city")
    if tags.get("highway") in HIGHWAYS or "building" in tags:
        return True
    if tags.get("highway") == "traffic_signals" or tags.get("public_transport") == "station" or tags.get("railway") == "station":
        return True
    if tags.get("natural") == "tree":
        return True
    return any(tags.get(k) in GREEN_KINDS for k in ("leisure", "landuse", "natural"))


def from_map_api(data: dict[str, Any], tier: str) -> list[dict[str, Any]]:
    """Turn an OSM API 0.6 map.json answer (nodes + ways with node ids) into Overpass-style elements with geometry."""
    nodes: dict[int, dict[str, Any]] = {}
    for el in data.get("elements", []):
        if el.get("type") == "node":
            nodes[el["id"]] = el
    out: list[dict[str, Any]] = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        if el.get("type") == "node":
            if tags and wanted(tags, tier):
                out.append({"type": "node", "id": el["id"], "lat": el["lat"], "lon": el["lon"], "tags": tags})
        elif el.get("type") == "way" and tags and wanted(tags, tier):
            geom = [{"lat": nodes[n]["lat"], "lon": nodes[n]["lon"]} for n in el.get("nodes", []) if n in nodes]
            if len(geom) >= 2:
                out.append({"type": "way", "id": el["id"], "tags": tags, "geometry": geom})
    return out


def intersects(el: dict[str, Any], b: BBox) -> bool:
    """Does this Overpass element touch the bbox? Nodes by position; ways by the bbox of their geometry."""
    if "lat" in el:
        return b.south <= el["lat"] <= b.north and b.west <= el["lon"] <= b.east
    g = el.get("geometry")
    if not g:
        return False
    lats = [p["lat"] for p in g]
    lons = [p["lon"] for p in g]
    return not (max(lats) < b.south or min(lats) > b.north or max(lons) < b.west or min(lons) > b.east)


class OverpassClient:
    """Rate-limited Overpass access with on-disk caching and a fixtures mode."""

    def __init__(self, cache: Cache, fixtures: Path | None = None, min_interval: float = 1.0, url: str | None = None, concurrency: int = 2):
        self.cache = cache
        self.fixtures = fixtures
        self.min_interval = min_interval
        # One or more Overpass endpoints, comma separated; the next one is tried when one fails.
        self.urls = [u.strip() for u in (url or settings.overpass_url).split(",") if u.strip()]
        self.url = self.urls[0]
        # Requests are launched at most one per min_interval, and at most `concurrency` run at once
        # (the public Overpass servers allow two slots per address). A slow upstream must never
        # hold every other tile behind it.
        self._lock = asyncio.Lock()
        self._slots = asyncio.Semaphore(max(1, concurrency))
        self._last = 0.0
        self._down: dict[str, float] = {}
        self._blocks: dict[str, asyncio.Future] = {}
        self.vtiles = VectorTileSource() if settings.osm_tiles_url else None
        self.live_calls = 0
        self.last_error: str | None = None
        self.warmed = 0

    async def tile(self, z: int, x: int, y: int, tier: str = "street") -> dict[str, Any]:
        key = f"osm:{tier}:{z}/{x}/{y}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        if self.fixtures is None:
            bz = BLOCK_ZOOM[tier]
            if z >= bz:
                try:
                    await self._block(tier, z, bz, x >> (z - bz), y >> (z - bz))
                    cached = self.cache.get(key)
                    if cached is not None:
                        return cached
                except Exception as e:  # a block too big or too slow: fall back to this one tile
                    log.warning("osm block for %s failed (%s: %s); fetching the single tile", key, type(e).__name__, str(e)[:120])
        bbox = tile_bbox(z, x, y)
        elements = await self._elements(bbox, tier, key)
        return self._store(z, x, y, tier, bbox, elements, time.time())

    def _store(self, z: int, x: int, y: int, tier: str, bbox: BBox, elements: list[dict[str, Any]], now: float) -> dict[str, Any]:
        key = f"osm:{tier}:{z}/{x}/{y}"
        result = {"key": f"{z}/{x}/{y}", "tier": tier,
                  "bounds": {"west": bbox.west, "south": bbox.south, "east": bbox.east, "north": bbox.north},
                  "entities": normalize(elements, now), "fetchedAt": int(now * 1000), "source": "openstreetmap"}
        self.cache.set(key, result, TILE_TTL, now)
        return result

    async def _block(self, tier: str, z: int, bz: int, bx: int, by: int) -> None:
        """Fetch one block and cache every z-tile inside it. Concurrent callers share one fetch."""
        bkey = f"{tier}:{bz}/{bx}/{by}"
        fut = self._blocks.get(bkey)
        if fut is None:
            fut = asyncio.get_running_loop().create_future()
            self._blocks[bkey] = fut
            try:
                bbox = tile_bbox(bz, bx, by)
                t0 = time.monotonic()
                elements: list[dict[str, Any]] | None = None
                if self.vtiles is not None:
                    try:
                        elements = await self.vtiles.elements(tier, bz, bx, by)
                        self.url = self.vtiles.base
                        self.last_error = None
                    except Exception as e:  # the CDN is down or the tile is odd: the live query path
                        self.vtiles.last_error = f"{type(e).__name__}: {str(e)[:160]}"
                        log.warning("vtile block %s failed (%s); using Overpass", bkey, self.vtiles.last_error)
                if elements is None:
                    elements = await self._elements(bbox, tier, f"osm:{bkey}", timeout_s=60)
                now = time.time()
                n = 1 << (z - bz)
                for dy in range(n):
                    for dx in range(n):
                        x, y = bx * n + dx, by * n + dy
                        tb = tile_bbox(z, x, y)
                        self._store(z, x, y, tier, tb, [el for el in elements if intersects(el, tb)], now)
                self.warmed += n * n
                log.info("osm block %s: %d elements -> %d tiles in %.1fs", bkey, len(elements), n * n, time.monotonic() - t0)
                fut.set_result(None)
            except Exception as e:
                fut.set_exception(e)
            finally:
                if not fut.done():  # the creating task was cancelled: release everyone waiting on this block
                    fut.set_exception(RuntimeError(f"block {bkey} fetch cancelled"))
                self._blocks.pop(bkey, None)
        await asyncio.shield(fut)

    async def warm(self, lng: float, lat: float, radius_blocks: int = 1) -> None:
        """Pre-fetch the street blocks around a point (and the district block over it) so the first visitor never waits."""
        for tier, r in (("district", 0), ("street", radius_blocks)):
            bz = BLOCK_ZOOM[tier]
            cx, cy = lnglat_to_tile(lng, lat, bz)
            z = 13 if tier == "district" else 16
            for by in range(cy - r, cy + r + 1):
                for bx in range(cx - r, cx + r + 1):
                    n = 1 << (z - bz)
                    if self.cache.get(f"osm:{tier}:{z}/{bx * n}/{by * n}") is not None:
                        continue
                    try:
                        await self._block(tier, z, bz, bx, by)
                    except Exception as e:
                        log.warning("warm %s %d/%d/%d: %s", tier, bz, bx, by, e)

    async def _elements(self, bbox: BBox, tier: str, key: str, timeout_s: int = 25) -> list[dict[str, Any]]:
        if self.fixtures is not None:
            f = self.fixtures / (key.replace(":", "_").replace("/", "_") + ".json")
            if f.exists():
                return json.loads(f.read_text()).get("elements", [])
            raise LookupError(f"no fixture for {key}")
        query = (MAJOR_QUERY if tier == "district" else STREET_QUERY).format(bbox=bbox.overpass()).replace("[timeout:25]", f"[timeout:{timeout_s}]")
        async with self._slots:
            async with self._lock:
                wait = self.min_interval - (time.monotonic() - self._last)
                if wait > 0:
                    await asyncio.sleep(wait)
                self._last = time.monotonic()
                self.live_calls += 1
            last_error: Exception | None = None
            now = time.monotonic()
            live = [u for u in self.urls if self._down.get(u, 0.0) <= now] or list(self.urls)
            for url in live:
                t0 = time.monotonic()
                try:
                    async with http_client(httpx.Timeout(timeout_s + 30.0, connect=8.0)) as client:
                        r = await client.post(url, data={"data": query})
                        r.raise_for_status()
                        self.url = url
                        self._down.pop(url, None)
                        self.last_error = None
                        log.info("osm %s via %s in %.1fs", key, url, time.monotonic() - t0)
                        return r.json().get("elements", [])
                except Exception as e:  # try the next mirror; the caller sees the last error
                    last_error = e
                    self._down[url] = time.monotonic() + DOWN_SECONDS
                    self.last_error = f"{url}: {type(e).__name__}: {str(e)[:160]}"
                    log.warning("osm %s failed via %s after %.1fs: %s: %s", key, url, time.monotonic() - t0, type(e).__name__, str(e)[:200])
            # Every mirror failed: the official API on a different host, splitting the area when it is too dense.
            if settings.osm_api_url:
                try:
                    elements = await self._map_api(bbox, tier)
                    self.url = settings.osm_api_url
                    self.last_error = None
                    log.info("osm %s via the OpenStreetMap API (%d elements)", key, len(elements))
                    return elements
                except Exception as e:
                    self.last_error = f"{settings.osm_api_url}: {type(e).__name__}: {str(e)[:160]} (after Overpass: {self.last_error})"
                    log.warning("osm %s failed via the map API too: %s: %s", key, type(e).__name__, str(e)[:200])
                    last_error = e
            raise last_error or RuntimeError("no Overpass endpoint configured")

    async def _map_api(self, bbox: BBox, tier: str, depth: int = 0) -> list[dict[str, Any]]:
        """GET /api/0.6/map.json for the bbox; on 400 (too many nodes) split into four and recurse (depth <= 3)."""
        async with http_client(httpx.Timeout(60.0, connect=8.0)) as client:
            r = await client.get(settings.osm_api_url, params={"bbox": f"{bbox.west:.6f},{bbox.south:.6f},{bbox.east:.6f},{bbox.north:.6f}"})
        if r.status_code == 400 and depth < 3:
            mx, my = (bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2
            quads = [BBox(bbox.west, bbox.south, mx, my), BBox(mx, bbox.south, bbox.east, my), BBox(bbox.west, my, mx, bbox.north), BBox(mx, my, bbox.east, bbox.north)]
            seen: set[tuple[str, int]] = set()
            out: list[dict[str, Any]] = []
            for q in quads:
                for el in await self._map_api(q, tier, depth + 1):
                    k = (el["type"], el["id"])
                    if k not in seen:
                        seen.add(k)
                        out.append(el)
            return out
        r.raise_for_status()
        return from_map_api(r.json(), tier)

    async def diagnose(self) -> list[dict[str, Any]]:
        """Try every source with a tiny request and report what the network does; for /api/diag/osm."""
        probe = BBox(77.2160, 28.6310, 77.2175, 28.6320)
        results: list[dict[str, Any]] = []
        targets = ([(self.vtiles.base, "vector-tiles")] if self.vtiles else []) + [(u, "overpass") for u in self.urls] + ([(settings.osm_api_url, "map-api")] if settings.osm_api_url else [])
        for url, kind in targets:
            host = httpx.URL(url).host
            entry: dict[str, Any] = {"url": url, "kind": kind, "host": host}
            try:
                infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
                entry["addresses"] = sorted({i[4][0] for i in infos})
            except Exception as e:
                entry["dns"] = f"{type(e).__name__}: {e}"
            t0 = time.monotonic()
            try:
                async with http_client(httpx.Timeout(15.0, connect=8.0)) as client:
                    if kind == "overpass":
                        r = await client.post(url, data={"data": f"[out:json][timeout:10];node[\"highway\"=\"traffic_signals\"]({probe.overpass()});out 1;"})
                    elif kind == "vector-tiles":
                        tpl = await self.vtiles.template(client)  # type: ignore[union-attr]
                        r = await client.get(tpl.replace("{z}", "14").replace("{x}", "11706").replace("{y}", "6799"))
                    else:
                        r = await client.get(url, params={"bbox": f"{probe.west},{probe.south},{probe.east},{probe.north}"})
                entry["status"] = r.status_code
                entry["bytes"] = len(r.content)
            except Exception as e:
                entry["error"] = f"{type(e).__name__}: {str(e)[:160]}"
            entry["seconds"] = round(time.monotonic() - t0, 2)
            entry["skippedUntil"] = round(self._down.get(url, 0.0) - time.monotonic(), 1) if url in self._down else 0
            results.append(entry)
        return results
