"""
Track record: does Atlas predict what actually happens? Two honest back-tests, both on real data.

1. Gentrification (premium places), per city: for each locality, read seven dates of OpenStreetMap
   history (36, 30, 24, 18, 12, 6 months ago and now). Fit the same projection the panel uses on the
   first five dates only (36 to 12 months ago), predict 6 and 12 months later, and compare with what
   was actually mapped. Reported next to a "nothing changes" guess, so the model has to beat it.
2. Traffic "usual for this hour": for recent readings in the city's memory, compare the usual level
   (median of the same weekday and hour, using only readings before that moment) with the measured one.

Nothing here is a price. The outcome for (1) is mapped premium places (cafés, coworking, spas...),
with the 5 km ring's mapping growth taken out; it says so wherever it is shown.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import statistics
import time
from typing import Any

from fastapi import FastAPI, Query

from .gentrification import history_query, months_ago_iso, project

log = logging.getLogger("atlas.trackrecord")

# Gurugram first: the first customer is land and project teams there (see docs/FIRST_CUSTOMER.md).
CITIES: dict[str, dict[str, Any]] = {
    "gurugram": {"label": "Gurugram", "centre": (77.0266, 28.4595), "localities": [
        "DLF Phase 1", "DLF Phase 3", "DLF Phase 4", "Cyber City", "Golf Course Road", "Sohna Road", "Sushant Lok 1", "South City 1",
        "Nirvana Country", "Palam Vihar", "Udyog Vihar", "Sector 14", "Sector 15", "Sector 29", "Sector 31", "Sector 45", "Sector 49",
        "Sector 56", "Sector 57", "Sector 65", "Sector 67", "Sector 70", "Sector 82", "Sector 84", "Sector 102", "Sector 106", "Sector 109", "Manesar"]},
}
BACKTEST_MONTHS = (36, 30, 24, 18, 12, 6, 0)
FIT_MONTHS = (36, 30, 24, 18, 12)
RESULT_TTL_S = 30 * 86400
HIST_TTL_S = 60 * 86400
TRAFFIC_TTL_S = 3600


# ---------------------------------------------------------------- metrics
def rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    r = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a: list[float], b: list[float]) -> float | None:
    """Rank correlation; None when there are too few points or no spread to rank."""
    if len(a) < 5 or len(set(a)) < 2 or len(set(b)) < 2:
        return None
    ra, rb = rank(a), rank(b)
    ma, mb = statistics.mean(ra), statistics.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return round(num / den, 2) if den else None


def ape(pred: float, actual: float) -> float:
    """Absolute error as a share of the actual (floored at 1 so tiny counts do not explode)."""
    return abs(pred - actual) / max(1.0, abs(actual))


def score_locality(name: str, rows: dict[int, dict[str, int]]) -> dict[str, Any] | None:
    """Fit on 36..12 months ago, predict 6 and 0 months ago; compare with what was mapped."""
    if any(m not in rows for m in BACKTEST_MONTHS):
        return None
    base_ring = rows[36]["ring"] or 1
    adj = {m: rows[m]["premium"] * base_ring / (rows[m]["ring"] or 1) for m in BACKTEST_MONTHS}
    xs = [-m for m in FIT_MONTHS]
    p = project(xs, [adj[m] for m in FIT_MONTHS], ahead=(6, 12))
    if p is None:
        return None
    p6, p12 = p["points"]
    at_fit_end = adj[12]
    actual6, actual0 = adj[6], adj[0]
    return {
        "name": name,
        "fitEnd": round(at_fit_end, 1),
        "predicted": {"m6": p6["predicted"], "m12": p12["predicted"], "lower12": p12["lower"], "upper12": p12["upper"], "lower6": p6["lower"], "upper6": p6["upper"]},
        "actual": {"m6": round(actual6, 1), "m12": round(actual0, 1)},
        "inBand12": p12["lower"] <= actual0 <= p12["upper"],
        "inBand6": p6["lower"] <= actual6 <= p6["upper"],
        "ape12": round(ape(p12["predicted"], actual0), 3),
        "apeNaive12": round(ape(at_fit_end, actual0), 3),
        "predictedChange": round(p12["predicted"] - at_fit_end, 2),
        "actualChange": round(actual0 - at_fit_end, 2),
        "premiumNow": rows[0]["premium"], "placesNow": rows[0]["total"],
    }


def summarise(results: list[dict[str, Any]]) -> dict[str, Any] | None:
    n = len(results)
    if n == 0:
        return None
    pc, ac = [r["predictedChange"] for r in results], [r["actualChange"] for r in results]
    moved = [(p, a) for p, a in zip(pc, ac) if abs(a) >= 0.5]
    third = max(1, n // 3)
    by_pred = sorted(results, key=lambda r: r["predictedChange"])
    top, bottom = by_pred[-third:], by_pred[:third]
    return {
        "localities": n,
        "inBand12": sum(r["inBand12"] for r in results), "inBand6": sum(r["inBand6"] for r in results),
        "inBandShare12": round(sum(r["inBand12"] for r in results) / n, 2),
        "medianErrorPct": round(statistics.median(r["ape12"] for r in results) * 100, 1),
        "medianErrorNaivePct": round(statistics.median(r["apeNaive12"] for r in results) * 100, 1),
        "directionRight": sum(1 for p, a in moved if (p > 0) == (a > 0)), "directionOutOf": len(moved),
        "rankCorrelation": spearman(pc, ac),
        "topThirdActualChange": round(statistics.mean(r["actualChange"] for r in top), 2),
        "bottomThirdActualChange": round(statistics.mean(r["actualChange"] for r in bottom), 2),
    }


def traffic_backtest(history: Any, now: float | None = None, days: int = 7, sample: int = 400, seed: int = 7) -> dict[str, Any]:
    """Usual-for-this-hour (only earlier readings) against what was measured, for a sample of recent readings."""
    now = time.time() if now is None else now
    since = now - days * 86400
    with history._lock:
        rows = history._conn.execute("SELECT ts, segment, level FROM flow_readings WHERE ts >= ? AND ts < ? ORDER BY ts", (since, now - 1800)).fetchall()
        first = history._conn.execute("SELECT MIN(ts) FROM flow_readings").fetchone()[0]
    random.Random(seed).shuffle(rows)
    errs: list[float] = []
    for ts, seg, lvl in rows:
        if len(errs) >= sample:
            break
        u = history.usual(seg, at=ts)
        if u["usual"] is None:
            continue
        errs.append(abs(u["usual"] - lvl))
    if not errs:
        return {"status": "waiting", "readings": len(rows), "memorySince": int(first * 1000) if first else None,
                "message": "Not enough memory yet: the usual for an hour needs readings from earlier weeks at that hour."}
    return {"status": "ok", "checked": len(errs), "readings": len(rows), "days": days, "memorySince": int(first * 1000) if first else None,
            "within10": round(sum(e <= 0.10 for e in errs) / len(errs), 2), "within20": round(sum(e <= 0.20 for e in errs) / len(errs), 2),
            "meanError": round(statistics.mean(errs), 3),
            "basis": "level = measured speed ÷ free-flow speed (TomTom); the guess is the median of the same weekday and hour, using only earlier readings"}


# ---------------------------------------------------------------- the running back-test
class TrackRecord:
    def __init__(self, osm: Any, history: Any, tomtom: Any, fixtures: Any = None) -> None:
        self.osm, self.history, self.tomtom, self.fixtures = osm, history, tomtom, fixtures
        self.cache = osm.cache
        self.jobs: dict[str, asyncio.Task] = {}
        self.progress: dict[str, dict[str, Any]] = {}

    async def _place(self, name: str, city: str) -> tuple[float, float] | None:
        c = CITIES[city]
        key = f"trk:place:{city}:{name.lower()}"
        hit = self.cache.get(key)
        if hit is not None:
            return tuple(hit) if hit else None
        try:
            res = await self.tomtom.geocode(f"{name}, {c['label']}", c["centre"][1], c["centre"][0], limit=3)
        except Exception as e:
            log.warning("track record: geocode %s failed: %s", name, e)
            return None
        for r in res:
            d_km = math.hypot((r["lng"] - c["centre"][0]) * 111.32 * math.cos(math.radians(c["centre"][1])), (r["lat"] - c["centre"][1]) * 110.57)
            if d_km <= 40:
                self.cache.set(key, [r["lng"], r["lat"]], 365 * 86400)
                return r["lng"], r["lat"]
        self.cache.set(key, [], 7 * 86400)
        return None

    async def _counts(self, lng: float, lat: float, months: int, now: float) -> dict[str, int]:
        import h3
        cell = h3.latlng_to_cell(lat, lng, 8)
        key = f"trk:hist:{cell}:{months}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        clat, clng = h3.cell_to_latlng(cell)
        fk = f"overpass_history_{months}" if self.fixtures is not None and (self.fixtures / f"overpass_history_{months}.json").exists() else ("overpass_history_default" if self.fixtures is not None else f"trk_{cell}_{months}")
        data = await self.osm.raw(history_query(clat, clng, None if months == 0 else months_ago_iso(months, now)), fk, timeout_s=120)
        c = [int((el.get("tags") or {}).get("total", 0)) for el in data.get("elements", []) if el.get("type") == "count"]
        if len(c) < 4:
            raise RuntimeError("Overpass history answered without the four counts")
        out = {"total": c[0], "premium": c[1], "food": c[2], "ring": c[3]}
        self.cache.set(key, out, HIST_TTL_S)
        return out

    async def _run(self, city: str) -> dict[str, Any]:
        now = time.time()
        names = CITIES[city]["localities"]
        prog = self.progress[city] = {"done": 0, "of": len(names), "skipped": []}
        results: list[dict[str, Any]] = []
        for name in names:
            try:
                ll = await self._place(name, city)
                if ll is None:
                    prog["skipped"].append({"name": name, "why": "not found by the geocoder"}); continue
                rows = {m: await self._counts(ll[0], ll[1], m, now) for m in BACKTEST_MONTHS}
                r = score_locality(name, rows)
                if r is None:
                    prog["skipped"].append({"name": name, "why": "history incomplete"})
                else:
                    results.append({**r, "lng": round(ll[0], 5), "lat": round(ll[1], 5)})
            except Exception as e:  # one locality failing does not stop the others
                log.warning("track record %s: %s failed: %s: %s", city, name, type(e).__name__, str(e)[:160])
                prog["skipped"].append({"name": name, "why": f"OpenStreetMap did not answer ({type(e).__name__})"})
            finally:
                prog["done"] += 1
                prog["partial"] = summarise(results)
        out = {"city": city, "label": CITIES[city]["label"], "computedAt": int(time.time() * 1000), "summary": summarise(results), "localities": results, "skipped": prog["skipped"],
               "method": "Fit on OpenStreetMap counts 36, 30, 24, 18 and 12 months ago; predict 6 and 12 months later; compare with what was mapped. Premium places with the 5 km ring's mapping growth taken out. Not a price."}
        if results:
            self.cache.set(f"trk:gentri:{city}", out, RESULT_TTL_S)
        return out

    def gentrification(self, city: str, start: bool = True) -> dict[str, Any]:
        done = self.cache.get(f"trk:gentri:{city}")
        if done is not None:
            return {"status": "ok", **done}
        t = self.jobs.get(city)
        if t is None or t.done():
            if not start:
                return {"status": "not started"}
            t = asyncio.ensure_future(self._run(city)); self.jobs[city] = t
            self.progress[city] = {"done": 0, "of": len(CITIES[city]["localities"]), "skipped": []}
        p = self.progress.get(city, {})
        return {"status": "running", "done": p.get("done", 0), "of": p.get("of", 0), "partial": p.get("partial"),
                "message": "Reading three years of OpenStreetMap history for each locality; the full check takes a while the first time and is kept for 30 days."}

    def traffic(self) -> dict[str, Any]:
        hit = self.cache.get("trk:traffic")
        if hit is not None:
            return hit
        out = traffic_backtest(self.history)
        if out["status"] == "ok":
            self.cache.set("trk:traffic", out, TRAFFIC_TTL_S)
        return out


def register(app: FastAPI, engine: TrackRecord) -> None:
    @app.get("/api/trackrecord")
    async def trackrecord(city: str = Query("gurugram", max_length=30)) -> dict[str, Any]:
        """How often Atlas's predictions came true, checked against what actually happened."""
        city = city.lower() if city.lower() in CITIES else "gurugram"
        traffic = await asyncio.to_thread(engine.traffic)
        return {"city": city, "cities": {k: v["label"] for k, v in CITIES.items()}, "gentrification": engine.gentrification(city), "traffic": traffic}
