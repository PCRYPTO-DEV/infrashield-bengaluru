"""TomTom traffic: flow vector tiles, incident details, and a daily budget guard.

Endpoints used (documented at developer.tomtom.com):
  Traffic Flow vector tiles   GET /traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.pbf?key=
  Traffic Flow Segment Data   GET /traffic/services/4/flowSegmentData/{style}/{zoom}/json?point=lat,lon&key=
  Traffic Incident Details v5 GET /traffic/services/5/incidentDetails?bbox=...&fields=...&key=

Everything returned here is `observed · tomtom`. The free tier allows
2,500 requests/day; `TOMTOM_DAILY_BUDGET` stops this server short of it.
"""
from __future__ import annotations

import functools
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from .cache import Cache
from .config import settings

FLOW_TTL = 120
SEGMENT_TTL = 60
INCIDENT_TTL = 60
FLOW_STYLE = "relative"  # vector flow tiles: traffic_level = current ÷ free-flow speed (relative0 is raster-only)
INCIDENT_FIELDS = "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}"

# iconCategory → Atlas incident kind (see TomTom Incident Details v5)
ICON_KIND = {0: "closure", 1: "collision", 2: "breakdown", 3: "closure", 4: "closure", 5: "flooding", 6: "breakdown", 7: "closure", 8: "closure", 9: "roadworks", 10: "closure", 11: "collision", 14: "breakdown"}
ICON_LABEL = {0: "Unknown", 1: "Accident", 2: "Fog", 3: "Dangerous conditions", 4: "Rain", 5: "Ice", 6: "Jam", 7: "Lane closed", 8: "Road closed", 9: "Road works", 10: "Wind", 11: "Flooding", 14: "Broken down vehicle"}


class BudgetExceeded(Exception):
    pass


class TomTomClient:
    def __init__(self, cache: Cache, api_key: str, fixtures: Path | None = None, daily_budget: int = 2000, base: str | None = None):
        self.cache = cache
        self.api_key = api_key
        self.fixtures = fixtures
        self.daily_budget = daily_budget
        self.base = base or settings.tomtom_base
        self.live_calls = 0
        self.history = None  # set by the app: every fresh reading is remembered
        self.hot = None  # set by the live module: tiles with a recent viewer

    # ---- budget ----
    def _day_key(self) -> str:
        return "tomtom:calls:" + datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def calls_today(self) -> int:
        return self.cache.count(self._day_key())

    def _spend(self) -> None:
        if self.calls_today() >= self.daily_budget:
            raise BudgetExceeded(f"TomTom daily budget of {self.daily_budget} requests reached")
        self.cache.increment(self._day_key())
        self.live_calls += 1

    # ---- transport ----
    async def _get(self, path: str, params: dict[str, Any], fixture_name: str, binary: bool = False) -> Any:
        if self.fixtures is not None:
            f = self.fixtures / fixture_name
            if not f.exists():
                # a '<kind>_default' file stands in for any request of that kind (dev fixtures)
                f = self.fixtures / (fixture_name.split("_")[0] + "_" + fixture_name.split("_")[1] + "_default" + f.suffix)
            if not f.exists():
                raise LookupError(f"no fixture {fixture_name}")
            return f.read_bytes() if binary else json.loads(f.read_text())
        if not self.api_key:
            raise HTTPException(503, "TOMTOM_API_KEY is not configured")
        self._spend()
        from .osm import http_client
        async with http_client(httpx.Timeout(20.0, connect=8.0)) as client:
            r = await client.get(self.base + path, params={**params, "key": self.api_key})
            r.raise_for_status()
            return r.content if binary else r.json()

    # ---- whole-country routing and place search (same key, live traffic) ----
    async def geocode(self, q: str, lat: float | None, lng: float | None, limit: int = 6) -> list[dict[str, Any]]:
        """Places anywhere in India by name: TomTom Search, biased to a point when given. Cached a day."""
        key = f"tomtom:geo:{q.strip().lower()}:{round(lat or 0, 1)},{round(lng or 0, 1)}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        params: dict[str, Any] = {"countrySet": "IN", "limit": limit, "language": "en-GB"}
        if lat is not None and lng is not None:
            params.update({"lat": lat, "lon": lng})
        from urllib.parse import quote
        data = await self._get(f"/search/2/search/{quote(q.strip())}.json", params, "tomtom_search.json")
        out = []
        for r in data.get("results", []):
            a = r.get("address", {}); pos = r.get("position", {})
            name = (r.get("poi") or {}).get("name") or a.get("freeformAddress") or q
            out.append({"name": name, "address": a.get("freeformAddress"), "town": a.get("municipality"), "lat": pos.get("lat"), "lng": pos.get("lon"), "kind": r.get("type"), "source": "tomtom-search"})
        self.cache.set(key, out, 86400, time.time())
        return out

    async def route(self, a: tuple[float, float], b: tuple[float, float], alternatives: int = 2) -> dict[str, Any]:
        """Routes with live traffic between two points anywhere: TomTom Routing. The fastest and its alternatives, cached 60 s."""
        key = f"tomtom:route:{a[0]:.4f},{a[1]:.4f}:{b[0]:.4f},{b[1]:.4f}:{alternatives}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        data = await self._get(f"/routing/1/calculateRoute/{a[0]},{a[1]}:{b[0]},{b[1]}/json",
                               {"traffic": "true", "routeType": "fastest", "maxAlternatives": alternatives, "travelMode": "car", "computeTravelTimeFor": "all"}, "tomtom_route.json")
        now = time.time()
        routes = []
        for i, r in enumerate(data.get("routes", [])):
            sm = r.get("summary", {})
            pts = [[p["longitude"], p["latitude"]] for leg in r.get("legs", []) for p in leg.get("points", [])]
            routes.append({"index": i, "lengthM": sm.get("lengthInMeters"), "travelTimeS": sm.get("travelTimeInSeconds"), "trafficDelayS": sm.get("trafficDelayInSeconds", 0),
                           "noTrafficTravelTimeS": sm.get("noTrafficTravelTimeInSeconds"), "arrival": sm.get("arrivalTime"), "points": pts})
        result = {"from": {"lat": a[0], "lng": a[1]}, "to": {"lat": b[0], "lng": b[1]}, "routes": routes, "fetchedAt": int(now * 1000), "source": "tomtom-routing",
                  "evidence": {"classification": "derived", "source": "tomtom-routing", "timestamp": int(now * 1000), "confidence": 0.8, "model": "tomtom routing with live traffic"}}
        self.cache.set(key, result, 60, now)
        return result

    # ---- flow tiles ----
    async def flow_tile(self, z: int, x: int, y: int, max_age: float | None = None) -> dict[str, Any]:
        """A flow tile from the cache (FLOW_TTL), or fresh when the cached one is older than `max_age` seconds."""
        key = f"tomtom:flow:{z}/{x}/{y}"
        cached = self.cache.get(key)
        if cached is not None and (max_age is None or (self.cache.age(key) or 0) <= max_age):
            return cached
        pbf = await self._get(f"/traffic/map/4/tile/flow/{FLOW_STYLE}/{z}/{x}/{y}.pbf", {}, f"tomtom_flow_{z}_{x}_{y}.pbf", binary=True)
        now = time.time()
        result = {"key": f"{z}/{x}/{y}", "fetchedAt": int(now * 1000), "segments": decode_flow_tile(pbf, z, x, y), "source": "tomtom", "style": FLOW_STYLE}
        self.cache.set(key, result, FLOW_TTL, now)
        if self.history is not None:
            self.history.record_flow(result["key"], result["segments"], now)
        return result

    async def flow_segment(self, lat: float, lng: float, zoom: int = 12) -> dict[str, Any]:
        key = f"tomtom:segment:{round(lat, 4)},{round(lng, 4)}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        data = await self._get(f"/traffic/services/4/flowSegmentData/{FLOW_STYLE}/{zoom}/json", {"point": f"{lat},{lng}", "unit": "KMPH"}, f"tomtom_segment_{round(lat, 4)}_{round(lng, 4)}.json")
        now = time.time()
        d = data.get("flowSegmentData", {})
        result = {"fetchedAt": int(now * 1000), "source": "tomtom", "currentSpeed": d.get("currentSpeed"), "freeFlowSpeed": d.get("freeFlowSpeed"),
                  "currentTravelTime": d.get("currentTravelTime"), "freeFlowTravelTime": d.get("freeFlowTravelTime"), "confidence": d.get("confidence"),
                  "roadClosure": d.get("roadClosure", False), "frc": d.get("frc"),
                  "coordinates": [[c["longitude"], c["latitude"]] for c in d.get("coordinates", {}).get("coordinate", [])]}
        self.cache.set(key, result, SEGMENT_TTL, now)
        return result

    # ---- incidents ----
    async def incidents(self, bbox: str, max_age: float | None = None) -> dict[str, Any]:
        key = f"tomtom:incidents:{bbox}"
        cached = self.cache.get(key)
        if cached is not None and (max_age is None or (self.cache.age(key) or 0) <= max_age):
            return cached
        data = await self._get("/traffic/services/5/incidentDetails", {"bbox": bbox, "fields": INCIDENT_FIELDS, "language": "en-GB", "timeValidityFilter": "present"}, f"tomtom_incidents_{bbox.replace(',', '_')}.json")
        now = time.time()
        result = {"fetchedAt": int(now * 1000), "source": "tomtom", "entities": normalize_incidents(data, now)}
        self.cache.set(key, result, INCIDENT_TTL, now)
        if self.history is not None:
            self.history.record_incidents(result["entities"], now)
        return result


def decode_flow_tile(pbf: bytes, z: int, x: int, y: int) -> list[dict[str, Any]]:
    """Decode a TomTom flow MVT into lng/lat segments with a relative speed level.

    TomTom's flow tiles carry a 'Traffic flow' layer whose line features have
    `traffic_level` (relative styles: current/free-flow ratio in 0..1) and
    `traffic_road_coverage`. Field names are read defensively; anything
    missing is reported as null rather than invented.
    """
    import mapbox_vector_tile

    decoded = mapbox_vector_tile.decode(pbf, default_options={"y_coord_down": True})
    out: list[dict[str, Any]] = []
    for layer_name, layer in decoded.items():
        extent = layer.get("extent", 4096)
        for i, feat in enumerate(layer.get("features", [])):
            geom = feat.get("geometry", {})
            if geom.get("type") not in ("LineString", "MultiLineString"):
                continue
            lines = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
            props = feat.get("properties", {})
            level = props.get("traffic_level")
            try:
                level = float(level) if level is not None else None
            except (TypeError, ValueError):
                level = None
            for j, line in enumerate(lines):
                coords = [tile_px_to_lnglat(px, py, z, x, y, extent) for px, py in line]
                out.append({"id": f"tt:{z}/{x}/{y}:{layer_name}:{i}:{j}", "coordinates": coords, "trafficLevel": level,
                            "roadCoverage": props.get("traffic_road_coverage"), "roadType": props.get("road_type"), "layer": layer_name})
    return out


def tile_px_to_lnglat(px: float, py: float, z: int, x: int, y: int, extent: int) -> list[float]:
    import math
    n = 2**z
    gx = (x + px / extent) / n
    gy = (y + py / extent) / n
    lng = gx * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy))))
    return [round(lng, 6), round(lat, 6)]


def normalize_incidents(data: dict[str, Any], now: float) -> list[dict[str, Any]]:
    out = []
    for inc in data.get("incidents", []):
        p = inc.get("properties", {})
        g = inc.get("geometry", {})
        coords = g.get("coordinates")
        if g.get("type") == "LineString" and coords:
            point = coords[len(coords) // 2]
        elif g.get("type") == "Point" and coords:
            point = coords
        else:
            continue
        cat = int(p.get("iconCategory", 0))
        start = _ts(p.get("startTime")) or int(now * 1000)
        end = _ts(p.get("endTime")) or (start + 3600_000)
        delay = p.get("delay") or 0
        mag = int(p.get("magnitudeOfDelay", 0))
        desc = "; ".join(e.get("description", "") for e in p.get("events", []) if e.get("description")) or ICON_LABEL.get(cat, "Incident")
        out.append({"id": f"tomtom:{p.get('id')}", "type": "incident", "geometry": {"type": "Point", "coordinates": point},
                    "timestamp": start, "evidence": {"classification": "observed", "source": "tomtom", "timestamp": int(now * 1000), "confidence": 0.85},
                    "properties": {"kind": ICON_KIND.get(cat, "closure"), "severity": round(min(1.0, 0.25 + 0.18 * mag), 2), "startTime": start, "endTime": end,
                                   "edgeId": "", "description": desc, "iconCategory": cat, "label": ICON_LABEL.get(cat, "Incident"), "delaySeconds": delay,
                                   "lengthM": p.get("length"), "from": p.get("from"), "to": p.get("to"), "roadNumbers": p.get("roadNumbers"),
                                   "line": coords if g.get("type") == "LineString" else None}})
    return out


def _ts(v: str | None) -> int | None:
    if not v:
        return None
    try:
        return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _incidents_near_route(history: Any, points: list[list[float]], radius_m: float = 300.0) -> list[dict[str, Any]]:
    """Active incidents (last 2 h) within `radius_m` of the route, sampled every few points."""
    if history is None or not points:
        return []
    import math
    lngs = [p[0] for p in points]; lats = [p[1] for p in points]
    pad = radius_m / 111320 * 1.2
    inc = history.incidents_in_bbox(min(lngs) - pad, min(lats) - pad, max(lngs) + pad, max(lats) + pad, since_s=7200)
    near = []
    step = max(1, len(points) // 300)  # at most ~300 samples per route, every point on short ones
    for i in inc:
        if i.get("lng") is None:
            continue
        kx = 111320 * math.cos(math.radians(i["lat"]))
        for p in points[::step]:
            if math.hypot((p[0] - i["lng"]) * kx, (p[1] - i["lat"]) * 111320) <= radius_m:
                near.append(i); break
    return near


def register(app: FastAPI, cache: Cache, fixtures: Path | None, history=None) -> None:
    client = TomTomClient(cache, settings.tomtom_api_key, fixtures, settings.tomtom_daily_budget)
    client.history = history
    app.state.tomtom = client

    def guard(fn):
        @functools.wraps(fn)
        async def run(*a, **k):
            try:
                return await fn(*a, **k)
            except BudgetExceeded as e:
                raise HTTPException(429, str(e))
            except LookupError as e:
                raise HTTPException(404, str(e))
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(503, f"TomTom unavailable: {type(e).__name__}: {e}")
        return run

    @app.get("/api/traffic/flow/{z}/{x}/{y}")
    @guard
    async def flow(z: int, x: int, y: int):
        if not 8 <= z <= 16:
            raise HTTPException(400, "flow tiles are served for zoom 8..16")
        if getattr(client, "hot", None) is not None:
            client.hot.touch(f"{z}/{x}/{y}")
        return await client.flow_tile(z, x, y)

    @app.get("/api/traffic/segment")
    @guard
    async def segment(lat: float = Query(...), lng: float = Query(...)):
        return await client.flow_segment(lat, lng)

    @app.get("/api/traffic/incidents")
    @guard
    async def incidents(bbox: str = Query(..., pattern=r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$")):
        if getattr(client, "hot", None) is not None:
            client.hot.touch_bbox(bbox)
        return await client.incidents(bbox)

    @app.get("/api/geocode")
    @guard
    async def geocode(q: str = Query(..., min_length=2, max_length=120), lat: float | None = Query(None), lng: float | None = Query(None)):
        return {"results": await client.geocode(q, lat, lng)}

    @app.get("/api/route")
    @guard
    async def route(frm: str = Query(..., alias="from", pattern=r"^-?[\d.]+,-?[\d.]+$"), to: str = Query(..., pattern=r"^-?[\d.]+,-?[\d.]+$"), alternatives: int = Query(2, ge=0, le=3)):
        """Routes with live traffic anywhere in India, plus the incidents the city has seen near each one, so a safer choice can be made."""
        a = tuple(float(v) for v in frm.split(",")); b = tuple(float(v) for v in to.split(","))
        r = await client.route((a[0], a[1]), (b[0], b[1]), alternatives)
        for rt in r["routes"]:
            near = _incidents_near_route(history, rt["points"])
            rt["incidentsNear"] = len(near)
            rt["incidentSeverity"] = round(sum(float(i.get("severity") or 0.5) for i in near), 2)
            rt["incidents"] = [{"kind": i.get("kind"), "description": i.get("description"), "lng": i.get("lng"), "lat": i.get("lat")} for i in near[:6]]
        routes = r["routes"]
        if routes:
            fastest = min(range(len(routes)), key=lambda i: routes[i]["travelTimeS"] or 1e9)
            # safer: strictly less reported incident severity than the fastest route, else the fastest is also the safer; never claims to be safe
            safer = min(range(len(routes)), key=lambda i: (routes[i]["incidentSeverity"], routes[i]["travelTimeS"] or 1e9))
            if routes[safer]["incidentSeverity"] >= routes[fastest]["incidentSeverity"]:
                safer = fastest
            extra_min = max(0, (routes[safer]["travelTimeS"] or 0) - (routes[fastest]["travelTimeS"] or 0)) // 60
            first = (f"The safer route passes fewer reported incidents ({routes[safer]['incidentsNear']} vs {routes[fastest]['incidentsNear']} within 300 m) and costs {extra_min} extra minutes."
                     if safer != fastest else "The fastest route also passes the fewest reported incidents right now.")
            r["recommended"] = {"fastest": fastest, "safer": safer}
            r["explanation"] = [first, "Times include live traffic (TomTom); incidents are the ones the city has seen in the last 2 hours. Lower reported risk is not a guarantee of safety."]
        return r

    @app.get("/api/traffic/status")
    async def status():
        return {"configured": bool(settings.tomtom_api_key), "fixtures": fixtures is not None, "callsToday": client.calls_today(), "dailyBudget": client.daily_budget}
