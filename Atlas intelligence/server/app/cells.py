"""The H3 city model: one state vector per cell, worked out from real readings and real structure only.

X(cell, t) = [traffic, safety, air, rain, green, access_health, access_school, access_transport, walkability,
              connectivity, built_intensity, noise_proxy, shopping, flood, population]

Each dimension carries a score (0..100, or None = "no data"), its evidence class (observed · derived ·
inferred), a confidence, the WHY lines and provenance rows. Where the inputs are missing the dimension is
None and says so: flood and population have no adapter yet, so they are always "no data" in Phase 1.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import Any

import h3

from .tiles import BBox, lnglat_to_tile, tile_bbox

RES = 9
M_PER_DEG_LAT = 111_320.0


def m_per_deg_lng(lat: float) -> float:
    return M_PER_DEG_LAT * math.cos(math.radians(lat))


def dist_m(a_lng: float, a_lat: float, b_lng: float, b_lat: float) -> float:
    return math.hypot((a_lng - b_lng) * m_per_deg_lng((a_lat + b_lat) / 2), (a_lat - b_lat) * M_PER_DEG_LAT)


def ring_area_m2(coords: list[list[float]], lat0: float) -> float:
    kx, ky = m_per_deg_lng(lat0), M_PER_DEG_LAT
    a = 0.0
    for i in range(len(coords) - 1):
        x1, y1 = coords[i][0] * kx, coords[i][1] * ky
        x2, y2 = coords[i + 1][0] * kx, coords[i + 1][1] * ky
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def line_len_m(coords: list[list[float]]) -> float:
    return sum(dist_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]) for i in range(len(coords) - 1))


def midpoint(coords: list[list[float]]) -> list[float]:
    return coords[len(coords) // 2]


def band(score: float | None) -> str | None:
    if score is None:
        return None
    return "excellent" if score >= 80 else "good" if score >= 60 else "moderate" if score >= 40 else "poor" if score >= 20 else "very poor"


def conf_word(c: float | None) -> str | None:
    return None if c is None else "high" if c >= 0.75 else "medium" if c >= 0.5 else "low"


def access_score(d_m: float | None) -> float | None:
    """Nearest service distance → 0..100: ≤ 500 m is 100, 2 km is 50, ≥ 5 km is 0."""
    if d_m is None:
        return None
    if d_m <= 500:
        return 100.0
    if d_m >= 5000:
        return 0.0
    return max(0.0, 100.0 - (d_m - 500) / 4500 * 100.0)


def prov(source: str, ts_ms: int | None, resolution: str, now: float) -> dict[str, Any]:
    age = None if not ts_ms else max(0, int(now - ts_ms / 1000))
    return {"source": source, "timestamp": ts_ms, "resolution": resolution, "freshnessS": age}


def dim(key: str, score: float | None, cls: str, confidence: float | None, why: list[str], provenance: list[dict[str, Any]], note: str | None = None) -> dict[str, Any]:
    return {"key": key, "score": None if score is None else round(score), "band": band(score), "class": cls, "confidence": confidence, "confidenceWord": conf_word(confidence), "why": why, "provenance": provenance, "note": note}


class CellModel:
    def __init__(self, osm: Any, history: Any, weather: Any, air: Any):
        self.osm, self.history, self.weather, self.air = osm, history, weather, air

    # ---- structure from the cached OpenStreetMap tiles ----
    async def entities_in(self, bbox: BBox, cached_only: bool = False) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for x, y in self._tiles(bbox):
            key = f"osm:street:16/{x}/{y}"
            cached = self.osm.cache.get(key)
            if cached is None:
                if cached_only:
                    continue
                try:
                    cached = await self.osm.tile(16, x, y, "street")
                except Exception:
                    continue
            out.extend(cached.get("entities", []))
        return out

    @staticmethod
    def _tiles(b: BBox) -> list[tuple[int, int]]:
        x0, y0 = lnglat_to_tile(b.west, b.north, 16)
        x1, y1 = lnglat_to_tile(b.east, b.south, 16)
        return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]

    async def state(self, lng: float, lat: float, res: int = RES, cached_only: bool = False, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        cell = h3.latlng_to_cell(lat, lng, res)
        clat, clng = h3.cell_to_latlng(cell)
        boundary = [[p[1], p[0]] for p in h3.cell_to_boundary(cell)]
        lngs, lats = [p[0] for p in boundary], [p[1] for p in boundary]
        b = BBox(min(lngs), min(lats), max(lngs), max(lats))
        area_km2 = h3.cell_area(cell, unit="km^2")
        # a wider box for services (about 2.5 km)
        pad_lng, pad_lat = 2500 / m_per_deg_lng(clat), 2500 / M_PER_DEG_LAT
        wide = BBox(clng - pad_lng, clat - pad_lat, clng + pad_lng, clat + pad_lat)
        inside = lambda ln, la: h3.latlng_to_cell(la, ln, res) == cell  # noqa: E731

        ents = await self.entities_in(wide, cached_only)
        tiles_seen = len(self._tiles(wide))
        osm_ts = max((e.get("evidence", {}).get("timestamp", 0) for e in ents), default=None) or None
        roads_km = {"arterial": 0.0, "collector": 0.0, "local": 0.0, "service": 0.0}
        paths = 0
        buildings, floors = 0, []
        green_m2 = 0.0
        transit: list[float] = []
        pois: dict[str, list[float]] = {}
        shops = 0
        for e in ents:
            t, g, p = e.get("type"), e.get("geometry", {}), e.get("properties", {})
            if t == "road" and g.get("type") == "LineString":
                m = midpoint(g["coordinates"])
                if inside(m[0], m[1]):
                    roads_km[p.get("roadClass", "local")] = roads_km.get(p.get("roadClass", "local"), 0.0) + line_len_m(g["coordinates"]) / 1000
            elif t == "path" and g.get("type") == "LineString":
                m = midpoint(g["coordinates"])
                if inside(m[0], m[1]):
                    paths += 1
            elif t == "building" and g.get("type") == "Polygon":
                ring = g["coordinates"][0]
                m = ring[len(ring) // 2]
                if inside(m[0], m[1]):
                    buildings += 1
                    floors.append(float(p.get("floors") or 1))
            elif t == "park" and g.get("type") == "Polygon":
                ring = g["coordinates"][0]
                m = ring[len(ring) // 2]
                if inside(m[0], m[1]):
                    green_m2 += ring_area_m2(ring, clat)
            elif t == "transit" and g.get("type") == "Point":
                transit.append(dist_m(clng, clat, g["coordinates"][0], g["coordinates"][1]))
            elif t == "poi" and g.get("type") == "Point":
                d = dist_m(clng, clat, g["coordinates"][0], g["coordinates"][1])
                pois.setdefault(p.get("kind", ""), []).append(d)
                if p.get("kind") in ("shop", "grocery", "food") and d <= 600:
                    shops += 1
        osm_prov = [prov("openstreetmap", osm_ts, "vector tiles z14 · entities", now)] if ents else []
        have_osm = len(ents) > 0

        # ---- live readings ----
        flow = self.history.flow_in_bbox(b.west, b.south, b.east, b.north, within_s=900, now=now) if self.history else []
        flow = [f for f in flow if f["lng"] is not None and inside(f["lng"], f["lat"])]
        incidents = self.history.incidents_in_bbox(wide.west, wide.south, wide.east, wide.north, since_s=86400, now=now) if self.history else []
        incidents_near = [i for i in incidents if i["lng"] is not None and dist_m(clng, clat, i["lng"], i["lat"]) <= 800]
        cams = self.history.camera_in_bbox(b.west, b.south, b.east, b.north, within_s=900, now=now) if self.history else []
        weather = None
        air = None
        try:
            weather = await self.weather.current(clat, clng) if self.weather else None
        except Exception:
            weather = None
        try:
            air = await self.air.current(clat, clng) if self.air else None
        except Exception:
            air = None

        dims: list[dict[str, Any]] = []
        # traffic (observed, TomTom) with usual (derived, memory)
        if flow:
            lvl = sum(f["level"] for f in flow) / len(flow)
            usual_vals, deltas = [], []
            for f in flow:
                u = self.history.usual(f["segment"], at=now)
                if u.get("usual") is not None:
                    usual_vals.append(u["usual"]); deltas.append(f["level"] - u["usual"])
            why = [f"{len(flow)} road segments measured by TomTom in the last 15 minutes; traffic is moving at {round(lvl * 100)}% of free speed on average."]
            if deltas:
                d = sum(deltas) / len(deltas)
                why.append(f"Usual for this weekday and hour: {round(sum(usual_vals) / len(usual_vals) * 100)}% ({'slower' if d < 0 else 'faster'} than usual by {abs(round(d * 100))} points, from the city's memory).")
            newest = max(f["ts"] for f in flow)
            dims.append(dim("traffic", lvl * 100, "observed", 0.85 * (1.0 if now - newest < 600 else 0.7), why, [prov("tomtom", int(newest * 1000), "road segment", now)] + ([prov("memory", int(now * 1000), "28-day medians", now)] if deltas else [])))
        else:
            dims.append(dim("traffic", None, "observed", None, ["No live speed reading inside this cell in the last 15 minutes."], [], "no data"))
        # safety activity (derived from reported incidents, 24 h, within 800 m)
        if self.history is not None:
            sev = sum(float(i.get("severity") or 0.5) for i in incidents_near)
            score = max(0.0, 100.0 - min(100.0, sev * 25.0))
            why = ([f"{len(incidents_near)} incident(s) reported within 800 m in the last 24 hours: " + "; ".join(f"{i['kind']} ({i['description']})" for i in incidents_near[:4]) + "."] if incidents_near else ["No incidents reported within 800 m in the last 24 hours (TomTom incident feed)."])
            why.append("Only reported road incidents are counted; this is not a crime measure.")
            dims.append(dim("safety", score, "derived", 0.6 if self.history.count("incident_readings") > 0 else 0.3, why, [prov("tomtom-incidents", int((max((i["ts"] for i in incidents_near), default=now)) * 1000), "point reports", now)]))
        # air (observed, CAMS model ~11 km)
        if air and air.get("euAqi") is not None:
            aqi = float(air["euAqi"])
            score = 100.0 if aqi <= 20 else 80.0 if aqi <= 40 else 60.0 if aqi <= 60 else 40.0 if aqi <= 80 else 20.0 if aqi <= 100 else 5.0
            prev = self.history.air_before(clat, clng, 86400, now) if self.history else None
            why = [f"European AQI {round(aqi)} ({air.get('band')}), PM2.5 {air.get('pm25')} µg/m³ (Open-Meteo air quality, CAMS model at about 11 km)."]
            if prev and prev.get("euAqi") is not None:
                why.append(f"24 hours ago the AQI here was {round(prev['euAqi'])}.")
            dims.append(dim("air", score, "observed", 0.7, why, [prov("open-meteo-air", air.get("fetchedAt"), "about 11 km", now)]))
        else:
            dims.append(dim("air", None, "observed", None, ["No air-quality reading available."], [], "no data"))
        # rain disruption (observed weather)
        if weather and weather.get("precipitationMm") is not None:
            mm = float(weather["precipitationMm"])
            score = 100.0 if mm == 0 else max(0.0, 100.0 - mm * 12.0)
            dims.append(dim("rain", score, "observed", 0.75, [f"{weather.get('description') or 'Weather'}, {mm} mm rain in the last hour, {weather.get('temperatureC')} °C (Open-Meteo)."], [prov("open-meteo", weather.get("fetchedAt"), "about 11 km", now)]))
        else:
            dims.append(dim("rain", None, "observed", None, ["No weather reading available."], [], "no data"))
        # green space (derived from OSM)
        if have_osm:
            share = green_m2 / (area_km2 * 1e6)
            dims.append(dim("green", min(100.0, share / 0.25 * 100.0), "derived", 0.7, [f"Mapped parks, gardens, woods and grass cover about {round(share * 100)}% of this cell (OpenStreetMap)."], osm_prov))
        else:
            dims.append(dim("green", None, "derived", None, ["Streets for this area are not loaded yet."], [], "no data"))
        # services (derived from OSM POIs within about 2.5 km)
        def nearest(kinds: tuple[str, ...]) -> float | None:
            ds = [d for k in kinds for d in pois.get(k, [])]
            return min(ds) if ds else None
        services = [("health", ("hospital", "clinic"), "hospital or clinic"), ("school", ("school", "college", "university"), "school or college"), ("police", ("police",), "police station"), ("fire", ("fire_station",), "fire station"), ("pharmacy", ("pharmacy",), "pharmacy")]
        for key, kinds, label in services:
            if not have_osm:
                dims.append(dim(f"access_{key}", None, "derived", None, ["Streets for this area are not loaded yet."], [], "no data")); continue
            d = nearest(kinds)
            if d is None:
                dims.append(dim(f"access_{key}", 0.0 if key in ("health", "school") else None, "derived", 0.5, [f"No mapped {label} within about 2.5 km (OpenStreetMap; unmapped ones are not counted)."], osm_prov, None if key in ("health", "school") else "no data"))
            else:
                dims.append(dim(f"access_{key}", access_score(d), "derived", 0.65, [f"Nearest mapped {label}: about {round(d / 100) * 100} m from the cell centre (straight line, OpenStreetMap)."], osm_prov))
        # public transport
        if have_osm:
            d = min(transit) if transit else None
            dims.append(dim("access_transport", access_score(d) if d is not None else 0.0, "derived", 0.65, [f"Nearest mapped station: about {round(d / 100) * 100} m." if d is not None else "No mapped station within about 2.5 km (OpenStreetMap)."], osm_prov))
        else:
            dims.append(dim("access_transport", None, "derived", None, ["Streets for this area are not loaded yet."], [], "no data"))
        # walkability (derived: footways + local street density + parks)
        if have_osm:
            local_km = roads_km["local"] + roads_km["service"]
            score = min(100.0, paths * 4.0 + min(60.0, local_km / area_km2 * 3.0) + (15.0 if green_m2 > 0 else 0.0))
            dims.append(dim("walkability", score, "derived", 0.55, [f"{paths} mapped footpaths, {round(local_km, 1)} km of local streets and {'some' if green_m2 > 0 else 'no'} green space in this cell (OpenStreetMap; pavements that are not mapped are not counted)."], osm_prov))
        else:
            dims.append(dim("walkability", None, "derived", None, ["Streets for this area are not loaded yet."], [], "no data"))
        # connectivity (derived: arterial + collector presence)
        if have_osm:
            art, col = roads_km["arterial"], roads_km["collector"]
            score = min(100.0, art / area_km2 * 25.0 + col / area_km2 * 12.0 + 20.0 * (1 if transit and min(transit) < 1000 else 0))
            dims.append(dim("connectivity", score, "derived", 0.6, [f"{round(art, 1)} km of main roads and {round(col, 1)} km of connecting roads in this cell; station within 1 km: {'yes' if transit and min(transit) < 1000 else 'no'}."], osm_prov))
        else:
            dims.append(dim("connectivity", None, "derived", None, ["Streets for this area are not loaded yet."], [], "no data"))
        # built intensity (derived; the trend needs daily snapshots)
        if have_osm:
            mean_fl = sum(floors) / len(floors) if floors else 0.0
            density = buildings / area_km2
            score = min(100.0, density / 20.0 + mean_fl * 6.0)
            dims.append(dim("built", score, "derived", 0.6, [f"{buildings} mapped buildings in this cell ({round(density)} per km²), average {round(mean_fl, 1)} floors (OpenStreetMap; floors are estimates where unmapped)."], osm_prov, "development pressure needs daily snapshots; the trend appears after two days"))
        else:
            dims.append(dim("built", None, "derived", None, ["Streets for this area are not loaded yet."], [], "no data"))
        # noise proxy (inferred from main roads and traffic)
        if have_osm:
            score = max(0.0, 100.0 - roads_km["arterial"] / area_km2 * 20.0 - (0 if not flow else 10.0))
            dims.append(dim("noise", score, "inferred", 0.4, [f"Inferred from {round(roads_km['arterial'], 1)} km of main roads in the cell{' and live traffic on them' if flow else ''}; no sound measurement exists."], osm_prov))
        # shopping
        if have_osm:
            dims.append(dim("shopping", min(100.0, shops * 12.0), "derived", 0.55, [f"{shops} mapped shops, groceries and eating places within 600 m (OpenStreetMap)."], osm_prov))
        # camera counts
        if cams:
            people = sum(c["people"] for c in cams)
            dims.append(dim("crowd", None, "observed", 0.7, [f"Cameras in this cell count {people} people and {sum(c['vehicles'] for c in cams)} vehicles right now (on-device counting, no faces)."], [prov("camera", int(max(c["ts"] for c in cams) * 1000), "camera view", now)]))
        # no adapters yet
        dims.append(dim("flood", None, "inferred", None, ["No elevation, drainage or waterlogging data is connected yet. Ask locally about basement waterlogging in the monsoon."], [], "no data"))
        dims.append(dim("population", None, "inferred", None, ["No population dataset is connected yet."], [], "no data"))

        # ---- Atlas score: weighted mean of the dimensions that have data ----
        weights = {"traffic": 1.0, "safety": 1.0, "air": 1.0, "rain": 0.5, "green": 0.5, "access_health": 1.0, "access_school": 0.5, "access_police": 0.25, "access_fire": 0.25, "access_pharmacy": 0.25, "access_transport": 1.0, "walkability": 0.5, "connectivity": 0.5, "noise": 0.25, "shopping": 0.25}
        num = den = cnum = cden = 0.0
        for d in dims:
            w = weights.get(d["key"], 0.0)
            if w and d["score"] is not None:
                num += w * d["score"]; den += w
                cnum += w * (d["confidence"] or 0.0); cden += w
        score = round(num / den, 1) if den else None
        confidence = round(cnum / cden, 2) if cden else None

        # ---- daily snapshot and trend ----
        trend = None
        day = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%d")
        if self.history is not None and score is not None:
            vec = json.dumps({d["key"]: d["score"] for d in dims})
            self.history.save_cell_day(cell, day, score, vec)
            days = self.history.cell_days(cell, 2)
            prev = next((r for r in days if r[0] != day), None)
            if prev and prev[1] is not None:
                trend = round(score - prev[1], 1)

        return {"cell": cell, "res": res, "centre": {"lng": clng, "lat": clat}, "boundary": boundary, "areaKm2": round(area_km2, 3),
                "score": score, "band": band(score), "trend": trend, "trendNote": None if trend is not None else "trend after two days of snapshots",
                "confidence": confidence, "confidenceWord": conf_word(confidence), "dimensions": dims,
                "structure": {"roadsKm": {k: round(v, 2) for k, v in roads_km.items()}, "paths": paths, "buildings": buildings, "greenShare": round(green_m2 / (area_km2 * 1e6), 3), "tilesChecked": tiles_seen, "entities": len(ents)},
                "computedAt": int(now * 1000), "classes": {"observed": "measured", "derived": "calculated from measurements", "inferred": "estimated from structure; no measurement", "predicted": "a model's guess about the future"}}
