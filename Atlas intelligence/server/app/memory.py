"""The city's memory: every live reading kept, so "now" can be compared with "usual".

Readings arrive from the feed clients (each TomTom flow tile fetched from
the network, each incident list) and from the app (camera counts, zone
events). Nothing here is ever made up: a baseline exists only once enough
readings for that weekday and hour have been seen.
"""
from __future__ import annotations

import sqlite3
import statistics
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

MIN_SAMPLES = 3
BASELINE_DAYS = 28


class History:
    def __init__(self, path: Path | str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        c = self._conn
        c.execute("CREATE TABLE IF NOT EXISTS flow_readings (ts REAL NOT NULL, tile TEXT NOT NULL, segment TEXT NOT NULL, level REAL NOT NULL, road_type TEXT, lng REAL, lat REAL)")
        c.execute("CREATE INDEX IF NOT EXISTS flow_seg_ts ON flow_readings (segment, ts)")
        c.execute("CREATE INDEX IF NOT EXISTS flow_tile_ts ON flow_readings (tile, ts)")
        c.execute("CREATE TABLE IF NOT EXISTS incident_readings (ts REAL NOT NULL, id TEXT NOT NULL, kind TEXT, severity REAL, lng REAL, lat REAL, description TEXT)")
        c.execute("CREATE INDEX IF NOT EXISTS inc_ts ON incident_readings (ts)")
        c.execute("CREATE TABLE IF NOT EXISTS camera_counts (ts REAL NOT NULL, camera TEXT NOT NULL, people INTEGER NOT NULL, vehicles INTEGER NOT NULL, lng REAL, lat REAL)")
        c.execute("CREATE INDEX IF NOT EXISTS cam_ts ON camera_counts (camera, ts)")
        c.execute("CREATE TABLE IF NOT EXISTS zone_events (ts REAL NOT NULL, zone TEXT NOT NULL, kind TEXT NOT NULL, description TEXT, lng REAL, lat REAL)")
        c.execute("CREATE INDEX IF NOT EXISTS zone_ts ON zone_events (zone, ts)")
        c.execute("CREATE TABLE IF NOT EXISTS air_readings (ts REAL NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, eu_aqi REAL, us_aqi REAL, pm25 REAL, pm10 REAL, no2 REAL, o3 REAL)")
        c.execute("CREATE INDEX IF NOT EXISTS air_ts ON air_readings (lat, lng, ts)")
        c.execute("CREATE TABLE IF NOT EXISTS cell_daily (h3 TEXT NOT NULL, day TEXT NOT NULL, score REAL, vector TEXT, PRIMARY KEY (h3, day))")
        c.commit()
        self.listeners: list[Any] = []

    # ---- recording ----
    def record_flow(self, tile: str, segments: list[dict[str, Any]], ts: float | None = None) -> int:
        ts = time.time() if ts is None else ts
        rows = []
        for s in segments:
            lvl = s.get("trafficLevel")
            if lvl is None:
                continue
            coords = s.get("coordinates") or []
            mid = coords[len(coords) // 2] if coords else (None, None)
            rows.append((ts, tile, s["id"], float(lvl), s.get("roadType"), mid[0], mid[1]))
        with self._lock:
            self._conn.executemany("INSERT INTO flow_readings VALUES (?,?,?,?,?,?,?)", rows)
            self._conn.commit()
        self._notify("flow", {"tile": tile, "ts": ts, "segments": rows})
        return len(rows)

    def record_incidents(self, entities: list[dict[str, Any]], ts: float | None = None) -> int:
        ts = time.time() if ts is None else ts
        rows = []
        for e in entities:
            p = e.get("properties", {})
            g = (e.get("geometry") or {}).get("coordinates") or [None, None]
            rows.append((ts, e.get("id"), p.get("kind"), p.get("severity"), g[0], g[1], p.get("description")))
        with self._lock:
            self._conn.executemany("INSERT INTO incident_readings VALUES (?,?,?,?,?,?,?)", rows)
            self._conn.commit()
        self._notify("incidents", {"ts": ts, "count": len(rows)})
        return len(rows)

    def record_camera(self, camera: str, people: int, vehicles: int, lng: float | None, lat: float | None, ts: float | None = None) -> None:
        ts = time.time() if ts is None else ts
        with self._lock:
            self._conn.execute("INSERT INTO camera_counts VALUES (?,?,?,?,?,?)", (ts, camera, people, vehicles, lng, lat))
            self._conn.commit()
        self._notify("camera", {"camera": camera, "people": people, "vehicles": vehicles, "ts": ts})

    def record_zone_event(self, zone: str, kind: str, description: str, lng: float | None, lat: float | None, ts: float | None = None) -> None:
        ts = time.time() if ts is None else ts
        with self._lock:
            self._conn.execute("INSERT INTO zone_events VALUES (?,?,?,?,?,?)", (ts, zone, kind, description, lng, lat))
            self._conn.commit()
        self._notify("zone", {"zone": zone, "kind": kind, "description": description, "ts": ts})

    def record_air(self, lat: float, lng: float, r: dict[str, Any], ts: float | None = None) -> None:
        ts = time.time() if ts is None else ts
        with self._lock:
            self._conn.execute("INSERT INTO air_readings VALUES (?,?,?,?,?,?,?,?,?)", (ts, lat, lng, r.get("euAqi"), r.get("usAqi"), r.get("pm25"), r.get("pm10"), r.get("no2"), r.get("o3")))
            self._conn.commit()

    def air_before(self, lat: float, lng: float, before_s: float, now: float | None = None) -> dict[str, Any] | None:
        """The reading nearest to `before_s` ago for this (rounded) spot, within a 3 h window."""
        now = time.time() if now is None else now
        target = now - before_s
        with self._lock:
            row = self._conn.execute("SELECT ts, eu_aqi, pm25 FROM air_readings WHERE lat = ? AND lng = ? AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1", (round(lat, 2), round(lng, 2), target - 5400, target + 5400, target)).fetchone()
        return {"ts": row[0], "euAqi": row[1], "pm25": row[2]} if row else None

    def save_cell_day(self, h3: str, day: str, score: float | None, vector: str) -> None:
        with self._lock:
            self._conn.execute("INSERT OR REPLACE INTO cell_daily VALUES (?,?,?,?)", (h3, day, score, vector))
            self._conn.commit()

    def cell_days(self, h3: str, limit: int = 30) -> list[tuple[str, float | None, str]]:
        with self._lock:
            return self._conn.execute("SELECT day, score, vector FROM cell_daily WHERE h3 = ? ORDER BY day DESC LIMIT ?", (h3, limit)).fetchall()

    def flow_in_bbox(self, west: float, south: float, east: float, north: float, within_s: float = 900, now: float | None = None) -> list[dict[str, Any]]:
        """Latest level per segment whose midpoint lies in the bbox, if recorded within `within_s`."""
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute("SELECT segment, level, ts, road_type, lng, lat FROM flow_readings WHERE ts >= ? AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ? ORDER BY ts ASC", (now - within_s, west, east, south, north)).fetchall()
        latest: dict[str, dict[str, Any]] = {}
        for seg, lvl, ts, rt, lng, lat in rows:
            latest[seg] = {"segment": seg, "level": lvl, "ts": ts, "roadType": rt, "lng": lng, "lat": lat}
        return list(latest.values())

    def incidents_in_bbox(self, west: float, south: float, east: float, north: float, since_s: float = 7200, now: float | None = None) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute("SELECT id, MAX(ts), kind, severity, lng, lat, description, MIN(ts) FROM incident_readings WHERE ts >= ? AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ? GROUP BY id", (now - since_s, west, east, south, north)).fetchall()
        return [{"id": r[0], "ts": r[1], "kind": r[2], "severity": r[3], "lng": r[4], "lat": r[5], "description": r[6], "firstSeen": r[7]} for r in rows]

    def camera_in_bbox(self, west: float, south: float, east: float, north: float, within_s: float = 900, now: float | None = None) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute("SELECT camera, MAX(ts), people, vehicles, lng, lat FROM camera_counts WHERE ts >= ? AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ? GROUP BY camera", (now - within_s, west, east, south, north)).fetchall()
        return [{"camera": r[0], "ts": r[1], "people": r[2], "vehicles": r[3], "lng": r[4], "lat": r[5]} for r in rows]

    def subscribe(self, fn: Any) -> None:
        self.listeners.append(fn)

    def _notify(self, kind: str, payload: dict[str, Any]) -> None:
        for fn in self.listeners:
            try:
                fn(kind, payload)
            except Exception:  # a listener must never break recording
                pass

    # ---- questions ----
    def latest_levels(self, tile: str, within_s: float = 900, now: float | None = None) -> dict[str, float]:
        """Most recent level per segment in a tile, if recorded within `within_s`."""
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute(
                "SELECT segment, level, ts FROM flow_readings WHERE tile = ? AND ts >= ? ORDER BY ts ASC", (tile, now - within_s)
            ).fetchall()
        out: dict[str, float] = {}
        for seg, lvl, _ts in rows:
            out[seg] = lvl
        return out

    def usual(self, segment: str, at: float | None = None) -> dict[str, Any]:
        """Median level for the same weekday and hour over the last 28 days; falls back to the same hour on any day."""
        at = time.time() if at is None else at
        d = datetime.fromtimestamp(at, timezone.utc)
        since = at - BASELINE_DAYS * 86400
        with self._lock:
            rows = self._conn.execute("SELECT ts, level FROM flow_readings WHERE segment = ? AND ts >= ? AND ts < ?", (segment, since, at - 1800)).fetchall()
        same_dow_hour = [lvl for ts, lvl in rows if (lambda x: x.weekday() == d.weekday() and x.hour == d.hour)(datetime.fromtimestamp(ts, timezone.utc))]
        same_hour = [lvl for ts, lvl in rows if datetime.fromtimestamp(ts, timezone.utc).hour == d.hour]
        if len(same_dow_hour) >= MIN_SAMPLES:
            return {"usual": statistics.median(same_dow_hour), "samples": len(same_dow_hour), "basis": "same weekday and hour"}
        if len(same_hour) >= MIN_SAMPLES:
            return {"usual": statistics.median(same_hour), "samples": len(same_hour), "basis": "same hour, any day"}
        return {"usual": None, "samples": len(rows), "basis": "not enough readings yet"}

    def compare(self, tile: str, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        latest = self.latest_levels(tile, now=now)
        out = {}
        for seg, lvl in latest.items():
            u = self.usual(seg, now)
            out[seg] = {"now": lvl, **u, "delta": (lvl - u["usual"]) if u["usual"] is not None else None}
        return {"tile": tile, "segments": out, "readingsKept": self.count("flow_readings")}

    def series(self, segment: str, hours: float = 24, now: float | None = None) -> list[list[float]]:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute("SELECT ts, level FROM flow_readings WHERE segment = ? AND ts >= ? ORDER BY ts", (segment, now - hours * 3600)).fetchall()
        return [[int(ts * 1000), lvl] for ts, lvl in rows]

    def camera_series(self, camera: str, hours: float = 24, now: float | None = None) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute("SELECT ts, people, vehicles FROM camera_counts WHERE camera = ? AND ts >= ? ORDER BY ts", (camera, now - hours * 3600)).fetchall()
        return [{"t": int(ts * 1000), "people": p, "vehicles": v} for ts, p, v in rows]

    def recent_zone_events(self, hours: float = 24, now: float | None = None, limit: int = 50) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute("SELECT ts, zone, kind, description FROM zone_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?", (now - hours * 3600, limit)).fetchall()
        return [{"t": int(ts * 1000), "zone": z, "kind": k, "description": d} for ts, z, k, d in rows]

    def count(self, table: str) -> int:
        with self._lock:
            return int(self._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

    def summary(self, hours: float = 24, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        since = now - hours * 3600
        with self._lock:
            flow = self._conn.execute("SELECT COUNT(*), COUNT(DISTINCT segment), MIN(ts) FROM flow_readings WHERE ts >= ?", (since,)).fetchone()
            inc = self._conn.execute("SELECT COUNT(DISTINCT id) FROM incident_readings WHERE ts >= ?", (since,)).fetchone()[0]
            cam = self._conn.execute("SELECT COUNT(*), COUNT(DISTINCT camera), COALESCE(MAX(people),0), COALESCE(MAX(vehicles),0) FROM camera_counts WHERE ts >= ?", (since,)).fetchone()
            zones = self._conn.execute("SELECT COUNT(*) FROM zone_events WHERE ts >= ?", (since,)).fetchone()[0]
            first = self._conn.execute("SELECT MIN(ts) FROM flow_readings").fetchone()[0]
        return {
            "hours": hours, "flowReadings": flow[0], "segments": flow[1], "incidents": inc,
            "cameraCounts": cam[0], "cameras": cam[1], "peakPeople": cam[2], "peakVehicles": cam[3], "zoneEvents": zones,
            "memorySince": int(first * 1000) if first else None,
        }


# ---- HTTP ----
class CameraObservation(BaseModel):
    cameraId: str = Field(..., max_length=64)
    people: int = Field(..., ge=0, le=100000)
    vehicles: int = Field(..., ge=0, le=100000)
    lng: float | None = None
    lat: float | None = None


class ZoneObservation(BaseModel):
    zone: str = Field(..., max_length=120)
    kind: str = Field(..., max_length=32)
    description: str = Field("", max_length=400)
    lng: float | None = None
    lat: float | None = None


def register(app: FastAPI, history: History) -> None:
    app.state.history = history

    @app.get("/api/history/compare")
    def compare(tile: str = Query(..., pattern=r"^\d{1,2}/\d+/\d+$")) -> dict[str, Any]:
        return history.compare(tile)

    @app.get("/api/history/series")
    def series(segment: str = Query(..., max_length=120), hours: float = Query(24, ge=0.1, le=24 * 60)) -> dict[str, Any]:
        return {"segment": segment, "points": history.series(segment, hours)}

    @app.get("/api/history/camera")
    def camera(camera: str = Query(..., max_length=64), hours: float = Query(24, ge=0.1, le=24 * 60)) -> dict[str, Any]:
        return {"camera": camera, "points": history.camera_series(camera, hours)}

    @app.get("/api/history/summary")
    def summary(hours: float = Query(24, ge=0.1, le=24 * 60)) -> dict[str, Any]:
        return {**history.summary(hours), "zoneEventsRecent": history.recent_zone_events(hours, limit=10)}

    @app.post("/api/observations/camera")
    def camera_obs(o: CameraObservation) -> dict[str, Any]:
        history.record_camera(o.cameraId, o.people, o.vehicles, o.lng, o.lat)
        return {"ok": True}

    @app.post("/api/observations/zone")
    def zone_obs(o: ZoneObservation) -> dict[str, Any]:
        if not o.kind.isalpha():
            raise HTTPException(400, "kind must be a word")
        history.record_zone_event(o.zone, o.kind, o.description, o.lng, o.lat)
        return {"ok": True}
