"""OpenStreetMap tiles via Overpass, normalised to Atlas Infinity UrbanEntities.

The normalisation mirrors web/src/data/adapters/openStreetMapAdapter.ts
(normalizeOsm) so the browser receives entities it already understands.
Every entity is `observed · openstreetmap`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from .cache import Cache
from .config import settings
from .tiles import BBox, tile_bbox

HIGHWAY_CLASS = {
    "motorway": "arterial", "trunk": "arterial", "primary": "arterial",
    "secondary": "collector", "tertiary": "collector",
    "residential": "local", "unclassified": "local", "living_street": "local", "service": "service",
    "motorway_link": "collector", "trunk_link": "collector", "primary_link": "collector", "secondary_link": "local",
}
MAXSPEED_DEFAULT = {"arterial": 13.9, "collector": 11.1, "local": 8.3, "service": 5.5}
TILE_TTL = 30 * 24 * 3600
log = logging.getLogger("atlas.osm")
# How long a mirror that failed is skipped before it is tried again.
DOWN_SECONDS = 60.0

STREET_QUERY = (
    '[out:json][timeout:25];('
    'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|motorway_link|trunk_link|primary_link|secondary_link)$"]({bbox});'
    'way["building"]({bbox});'
    'node["highway"="traffic_signals"]({bbox});'
    'node["public_transport"="station"]({bbox});'
    'node["railway"="station"]({bbox});'
    'way["leisure"="park"]({bbox});'
    ');out geom;'
)
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
            elif tags.get("place"):
                out.append({"id": f"osm:n{el['id']}", "type": "zone", "geometry": geom, "evidence": ev(),
                            "properties": {"name": tags.get("name", tags["place"]), "restricted": False, "place": tags["place"]}})
            continue
        if t == "way" and el.get("geometry") and len(el["geometry"]) >= 2:
            coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
            if "highway" in tags:
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
            elif tags.get("leisure") == "park":
                out.append({"id": f"osm:w{el['id']}", "type": "park", "geometry": {"type": "Polygon", "coordinates": [close_ring(coords)]},
                            "evidence": ev(), "properties": {"name": tags.get("name", "Park"), "areaM2": 0, "osm": tags}})
    return out


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
        self.live_calls = 0
        self.last_error: str | None = None

    async def tile(self, z: int, x: int, y: int, tier: str = "street") -> dict[str, Any]:
        key = f"osm:{tier}:{z}/{x}/{y}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        bbox = tile_bbox(z, x, y)
        elements = await self._elements(bbox, tier, key)
        now = time.time()
        result = {"key": f"{z}/{x}/{y}", "tier": tier,
                  "bounds": {"west": bbox.west, "south": bbox.south, "east": bbox.east, "north": bbox.north},
                  "entities": normalize(elements, now), "fetchedAt": int(now * 1000), "source": "openstreetmap"}
        self.cache.set(key, result, TILE_TTL, now)
        return result

    async def _elements(self, bbox: BBox, tier: str, key: str) -> list[dict[str, Any]]:
        if self.fixtures is not None:
            f = self.fixtures / (key.replace(":", "_").replace("/", "_") + ".json")
            if f.exists():
                return json.loads(f.read_text()).get("elements", [])
            raise LookupError(f"no fixture for {key}")
        query = (MAJOR_QUERY if tier == "district" else STREET_QUERY).format(bbox=bbox.overpass())
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
                    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=8.0)) as client:
                        r = await client.post(url, data={"data": query}, headers={"User-Agent": "atlas-infinity/0.2 (OpenStreetMap data for a live city map)"})
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
            raise last_error or RuntimeError("no Overpass endpoint configured")
