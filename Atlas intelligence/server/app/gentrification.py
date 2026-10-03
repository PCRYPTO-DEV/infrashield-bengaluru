"""
City Atlas Pro: gentrification. The BSOCIAL community engine (Community Behaviour Index, Gentrification
Index, archetypes, advisory) ported onto real data only.

Inputs, all real:
- the places people mapped in OpenStreetMap within 1 km (Overpass; BSOCIAL's own query and categories),
- the same counts 6, 12, 18 and 24 months ago (Overpass history, `[date:...]`), for the area and its 5 km ring,
- news headlines naming the area in the last 30 days (Google News RSS),
- crimes reported in City Atlas and the news over 90 days, and road incidents the city recorded.

What BSOCIAL computed from nothing is not computed here: price momentum, rental turnover, liquidity,
households, age and income. Price momentum is used only when the person types a price trend of their
own, and is labelled as theirs. A part with no input is "no data" and the index says how much of its
weight it covers.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from .news import city_for, parse_feed
from .osm import http_client

log = logging.getLogger("atlas.gentrification")

RADIUS_M = 1000          # BSOCIAL's scan radius for one place
CENSUS_RADIUS_M = 2500   # one fetch per H3 res-7 cell covers the 1 km circle of any point in it
RING_RADIUS_M = 5000     # the baseline that takes out city-wide mapping drives
CENSUS_TTL_S = 7 * 86400
HISTORY_TTL_S = 30 * 86400
NEWS_TTL_S = 6 * 3600
HISTORY_MONTHS = (24, 18, 12, 6, 0)
WAIT_S = 14.0            # a cold request waits this long, then answers "pending" and keeps fetching
FAIL_TTL_S = 900         # a source that failed is not asked again for this long (no hammering a public server)
MAX_GRID_DEG2 = 0.05

# ---- BSOCIAL's categories, ported from the app (Av / wv / the counting loop) ----
PREMIUM_VALUES = {"coworking", "yoga", "pilates", "organic", "spa", "art_gallery", "wine_bar", "boutique", "ev_charging", "international_school", "microbrewery", "health_food", "fitness_centre", "swimming_pool"}
PREMIUM_NAME = ("organic", "artisan", "premium", "boutique", "spa", "yoga", "pilates", "cowork", "co-work", "ev charg", "wework", "awfis", "91springboard", "regus", "smartworks")
PREMIUM_CUISINE = ("sushi", "italian", "japanese")
COWORK_BRANDS = ("wework", "awfis", "91springboard", "cowrks", "innov8", "regus", "smartworks", "bhive", "workshala", "spring house", "hustlehub", "collab house", "the hive", "workafella", "ikeva",
                 "incuspaze", "cokarma", "dextrus", "skootr", "devx", "myhrdesk", "workshaala", "altf", "covork", "worqspot", "ishan cowork", "zipcowork", "gowork", "spaces", "iw group")
KEYS = ("cafes", "restaurants", "gyms", "schools", "hospitals", "parks", "banks", "shops", "coworking", "premium")
BIT = {k: 1 << i for i, k in enumerate(KEYS)}

# Archetype centroids over (F, I, L, E, S, G, D), and the softmax temperature, as in BSOCIAL
ARCHETYPES = [
    ("family-stability", "Family Stability Cluster", (0.85, 0.15, 0.45, 0.75, 0.9, 0.2, 0.35)),
    ("young-professional", "Young Professional Cluster", (0.25, 0.3, 0.85, 0.4, 0.35, 0.65, 0.9)),
    ("investor-dominant", "Investor-Dominant Cluster", (0.2, 0.9, 0.5, 0.15, 0.25, 0.55, 0.45)),
    ("transitional-premium", "Transitional Premiumization", (0.45, 0.4, 0.7, 0.35, 0.4, 0.8, 0.75)),
    ("quiet-established", "Quiet Established Community", (0.7, 0.1, 0.3, 0.6, 0.95, 0.1, 0.2)),
    ("high-mobility-rental", "High Mobility Rental", (0.15, 0.55, 0.75, 0.2, 0.15, 0.7, 0.8)),
]
TEMPERATURE = 0.3
CBI_WEIGHTS = {"family": 0.15, "investor": 0.12, "lifestyle": 0.15, "engagement": 0.13, "stability": 0.15, "gentrification": 0.15, "buzz": 0.15}
GI_WEIGHTS = {"amenityPremium": 0.30, "priceMomentum": 0.35, "rentalTurnover": 0.15, "digitalBuzz": 0.20}


def te(x: float, lo: float, hi: float) -> float:
    """BSOCIAL's clamp-and-scale: where x sits between lo and hi, 0..1."""
    return 0.5 if hi == lo else max(0.0, min(1.0, (x - lo) / (hi - lo)))


def classify(tags: dict[str, str]) -> int:
    """Category bits for one mapped place, exactly as BSOCIAL counts it."""
    a, shop, leis, off = tags.get("amenity", ""), tags.get("shop", ""), tags.get("leisure", ""), tags.get("office", "")
    name = (tags.get("name") or "").lower()
    cuisine = tags.get("cuisine") or ""
    bits = 0
    if a in ("cafe", "coffee"):
        bits |= BIT["cafes"]
    elif a in ("restaurant", "fast_food"):
        bits |= BIT["restaurants"]
    elif a in ("gym", "fitness_centre") or leis == "fitness_centre":
        bits |= BIT["gyms"]
    elif a in ("school", "college", "university"):
        bits |= BIT["schools"]
    elif a in ("hospital", "clinic", "doctors"):
        bits |= BIT["hospitals"]
    elif leis in ("park", "garden", "playground"):
        bits |= BIT["parks"]
    elif a in ("bank", "atm"):
        bits |= BIT["banks"]
    elif shop:
        bits |= BIT["shops"]
    if (a == "coworking_space" or off in ("coworking", "coworking_space") or tags.get("coworking") == "yes" or "cowork" in name or "co-work" in name or "co work" in name
            or "shared office" in name or "business centre" in name or "business center" in name or any(b in name for b in COWORK_BRANDS)):
        bits |= BIT["coworking"]
    if (a in PREMIUM_VALUES or shop in PREMIUM_VALUES or a == "coworking_space" or off in ("coworking", "coworking_space") or tags.get("coworking") == "yes"
            or any(k in name for k in PREMIUM_NAME) or any(k in cuisine for k in PREMIUM_CUISINE)):
        bits |= BIT["premium"]
    return bits


def counts_within(points: list[list[float]], lng: float, lat: float, radius_m: float = RADIUS_M) -> dict[str, Any]:
    """Counts of each kind among the compact places [lat, lng, bits] within radius_m of the point."""
    kx = 111_320.0 * math.cos(math.radians(lat))
    r2 = radius_m * radius_m
    c = {k: 0 for k in KEYS}
    total = 0
    for plat, plng, bits in points:
        dx, dy = (plng - lng) * kx, (plat - lat) * 110_570.0
        if dx * dx + dy * dy > r2:
            continue
        total += 1
        for k in KEYS:
            if bits & BIT[k]:
                c[k] += 1
    return {"total": total, **c, "radiusM": radius_m}


# ---- the indices (BSOCIAL formulas; where an input does not exist here, the term is left out and the rest re-weighted) ----
def _mix(terms: list[tuple[float, float | None]]) -> float | None:
    have = [(w, v) for w, v in terms if v is not None]
    den = sum(w for w, _ in have)
    return None if den <= 0 else max(0.0, min(1.0, sum(w * v for w, v in have) / den))


def components(c: dict[str, Any], news_mentions: int | None, crimes_90d: int | None) -> dict[str, dict[str, Any]]:
    total = c["total"]
    area_km2 = math.pi * (c["radiusM"] / 1000.0) ** 2
    dens = total / max(1.0, area_km2)
    prem = c["premium"] / total if total else 0.0
    food = (c["cafes"] + c["restaurants"]) / total if total else 0.0
    civic = (c["schools"] + c["hospitals"]) / total if total else 0.0
    buzz = te(news_mentions, 0, 25) if news_mentions is not None else None

    fam = max(0.0, min(1.0, te(c["schools"], 0, 8) * 0.35 + te(c["hospitals"], 0, 5) * 0.2 + te(c["parks"], 0, 6) * 0.2 + (1 - food) * 0.15 + te(civic, 0, 0.3) * 0.1))
    inv = max(0.0, min(1.0, te(c["coworking"], 0, 5) * 0.3 + te(dens, 0, 500) * 0.2 + (1 - fam) * 0.25 + prem * 0.25))
    life = max(0.0, min(1.0, te(c["cafes"] + c["restaurants"], 0, 30) * 0.35 + te(c["gyms"], 0, 5) * 0.2 + prem * 0.25 + te(dens, 0, 300) * 0.2))
    # BSOCIAL: parks .25, schools .2, Reddit mentions .3, Reddit sentiment .25. Here news mentions stand in for Reddit; sentiment is not measured.
    eng = _mix([(0.25, te(c["parks"], 0, 5)), (0.2, te(c["schools"], 0, 5)), (0.3, buzz)])
    stab = max(0.0, min(1.0, te(c["banks"], 0, 8) * 0.2 + te(c["schools"], 0, 6) * 0.25 + te(c["hospitals"], 0, 4) * 0.15 + (1 - inv) * 0.25 + (1 - prem) * 0.15))
    if crimes_90d:  # Atlas addition: reported crime lowers stability (no change when none were reported)
        stab *= 1 - 0.3 * te(crimes_90d, 0, 30)
    gen = max(0.0, min(1.0, prem * 0.35 + te(c["coworking"], 0, 4) * 0.2 + te(c["cafes"], 0, 15) * 0.2 + te(dens, 0, 400) * 0.15 + food * 0.1))
    # BSOCIAL: Nominatim fame .4, Reddit mentions .3, coworking .15, premium share .15. Fame is not buzz; without headlines there is no buzz.
    dig = _mix([(0.3, buzz), (0.15, te(c["coworking"], 0, 3)), (0.15, prem)]) if buzz is not None else None
    n = total
    why = {
        "family": f"{c['schools']} schools, {c['hospitals']} clinics or hospitals, {c['parks']} parks and playgrounds within {c['radiusM']} m; {round(food * 100)}% of places are food.",
        "investor": f"{c['coworking']} coworking spaces, {round(dens)} mapped places per km², {round(prem * 100)}% premium places.",
        "lifestyle": f"{c['cafes']} cafés, {c['restaurants']} restaurants, {c['gyms']} gyms; {round(prem * 100)}% premium places.",
        "engagement": f"{c['parks']} parks, {c['schools']} schools" + (f", {news_mentions} news stories naming the area in 30 days." if news_mentions is not None else "; news mentions not available."),
        "stability": f"{c['banks']} banks or ATMs, {c['schools']} schools, {c['hospitals']} clinics; less investor churn and fewer premium flips read as more stable" + (f"; {crimes_90d} crimes reported nearby in 90 days." if crimes_90d else "."),
        "gentrification": f"{c['premium']} of {n} places are premium (organic, spa, coworking, boutique, yoga...), {c['coworking']} coworking, {c['cafes']} cafés.",
        "buzz": (f"{news_mentions} news stories named the area in 30 days; {c['coworking']} coworking; {round(prem * 100)}% premium." if news_mentions is not None else "No headline count for this area yet."),
    }
    vals = {"family": fam, "investor": inv, "lifestyle": life, "engagement": eng, "stability": stab, "gentrification": gen, "buzz": dig}
    return {k: {"value": None if v is None else round(v, 3), "why": why[k]} for k, v in vals.items()}


def cbi(comp: dict[str, dict[str, Any]]) -> dict[str, Any]:
    num = den = 0.0
    for k, w in CBI_WEIGHTS.items():
        v = comp[k]["value"]
        if v is not None:
            num += w * v; den += w
    return {"value": round(num / den * 100) if den else None, "coverage": round(den / sum(CBI_WEIGHTS.values()), 2)}


def gi_class(v: float | None) -> str | None:
    if v is None:
        return None
    return "stable" if v < 40 else "transitional" if v < 60 else "emerging" if v < 80 else "high"


def gi(c: dict[str, Any], comp: dict[str, dict[str, Any]], price_trend_pct: float | None = None) -> dict[str, Any]:
    total = c["total"]
    prem = c["premium"] / total if total else 0.0
    parts: dict[str, dict[str, Any]] = {
        "amenityPremium": {"value": round(min(1.0, prem * 1.2 + te(c["coworking"], 0, 3) * 0.3), 3), "class": "derived", "why": f"{c['premium']} premium places of {total} mapped, {c['coworking']} coworking (OpenStreetMap)."},
        "priceMomentum": ({"value": round(te(price_trend_pct, -10, 40), 3), "class": "your figure", "why": f"Your price trend: {price_trend_pct:+.1f}% a year."} if price_trend_pct is not None
                          else {"value": None, "class": None, "why": "No property-price source is connected. Type a yearly price trend you trust to include it."}),
        "rentalTurnover": {"value": None, "class": None, "why": "No rental-listing source is connected."},
        "digitalBuzz": ({"value": comp["buzz"]["value"], "class": "observed", "why": comp["buzz"]["why"]} if comp["buzz"]["value"] is not None
                        else {"value": None, "class": None, "why": "No headline count for this area yet."}),
    }
    num = den = 0.0
    for k, w in GI_WEIGHTS.items():
        if parts[k]["value"] is not None:
            num += w * parts[k]["value"]; den += w
    value = round(num / den * 100) if den else None
    return {"value": value, "class": gi_class(value), "coverage": round(den, 2), "components": [{"key": k, "weight": GI_WEIGHTS[k], **parts[k]} for k in GI_WEIGHTS]}


def archetypes(comp: dict[str, dict[str, Any]]) -> list[dict[str, Any]] | None:
    order = ("family", "investor", "lifestyle", "engagement", "stability", "gentrification", "buzz")
    vec = [comp[k]["value"] for k in order]
    keep = [i for i, v in enumerate(vec) if v is not None]
    if len(keep) < 5:
        return None
    dists = [math.sqrt(sum((cent[i] - vec[i]) ** 2 for i in keep)) for _, _, cent in ARCHETYPES]
    ex = [math.exp(-d / TEMPERATURE) for d in dists]
    tot = sum(ex)
    out = [{"id": a[0], "label": a[1], "probability": round(e / tot, 2)} for a, e in zip(ARCHETYPES, ex)]
    return sorted(out, key=lambda r: r["probability"], reverse=True)


def trend(values: list[float]) -> dict[str, Any]:
    """BSOCIAL's trend vector: second half against first half, and whether the slope is growing."""
    if len(values) < 4:
        return {"direction": "flat", "strength": 0.0, "slope": 0.0}
    n = len(values); h = n // 2
    a, b = values[:h], values[h:]
    ma = sum(a) / len(a)
    rel = ((sum(b) / len(b)) - ma) / ma if ma else 0.0
    sa = (a[-1] - a[0]) / (len(a) or 1)
    accel = (b[-1] - b[0]) / (len(b) or 1) - sa
    d = "accelerating" if rel > 0.02 and accel > 0 else "steady-up" if rel > 0.02 else "declining" if rel < -0.02 and accel < 0 else "decelerating" if rel < -0.02 else "flat"
    return {"direction": d, "strength": round(min(1.0, abs(rel) * 5), 2), "slope": round(rel * 1000) / 10}


def project(xs: list[float], ys: list[float], ahead: tuple[float, ...] = (6, 12)) -> dict[str, Any] | None:
    """BSOCIAL's weighted regression with widening bands, on real points (x in months). Needs four points."""
    n = len(ys)
    if n < 4:
        return None
    sw = swx = swy = swxx = swxy = 0.0
    for i, (x, y) in enumerate(zip(xs, ys)):
        w = 1 + i * 0.5
        sw += w; swx += w * x; swy += w * y; swxx += w * x * x; swxy += w * x * y
    det = sw * swxx - swx * swx
    if det == 0:
        return None
    slope = (sw * swxy - swx * swy) / det
    icpt = (swy - slope * swx) / sw
    rmse = math.sqrt(sum((y - (icpt + slope * x)) ** 2 for x, y in zip(xs, ys)) / n)
    out = []
    for m in ahead:
        x = xs[-1] + m
        p = icpt + slope * x
        band = rmse * (1 + m * 0.15)
        out.append({"months": m, "predicted": round(max(0.0, p), 1), "upper": round(max(0.0, p + band), 1), "lower": round(max(0.0, p - band), 1), "confidence": round(max(0.2, 1 - m * 0.06), 2)})
    return {"points": out, "slopePerYear": round(slope * 12, 2)}


def advisory(cbi_v: int | None, gi_v: int | None, gi_cov: float, neighbours: list[dict[str, Any]], crimes_90d: int | None) -> dict[str, Any]:
    """BSOCIAL's government advisory rules that rest on measured things. Rules that needed invented households,
    ages or a cohesion network are left out; reported crime stands in for the law-and-order rule."""
    items: list[dict[str, Any]] = []
    if gi_v is not None:
        if gi_v >= 70:
            items.append({"key": "infra_pressure", "severity": "critical", "gi": gi_v})
        elif gi_v >= 50:
            items.append({"key": "infra_planning", "severity": "medium", "gi": gi_v})
        if gi_v >= 65 and cbi_v is not None and cbi_v < 50:
            items.append({"key": "displacement", "severity": "high", "gi": gi_v, "cbi": cbi_v})
        if gi_v >= 50:
            items.append({"key": "environment", "severity": "low"})
    if crimes_90d is not None and crimes_90d >= 10 and cbi_v is not None and cbi_v < 40:
        items.append({"key": "law_order", "severity": "high", "crimes": crimes_90d, "cbi": cbi_v})
    hot = [n for n in neighbours if (n.get("gi") or 0) > 60]
    if len(hot) >= 2:
        items.append({"key": "spillover", "severity": "medium", "cells": [n["cell"] for n in hot]})
    crit = sum(1 for i in items if i["severity"] == "critical")
    high = sum(1 for i in items if i["severity"] == "high")
    med = sum(1 for i in items if i["severity"] == "medium")
    level = "critical" if crit else "high" if high >= 2 else "elevated" if high else "moderate" if med else "low"
    return {"level": level, "items": items, "basis": f"rules on GI, CBI, neighbouring cells and reported crime; GI covers {round(gi_cov * 100)}% of its weight"}


def developer_grade(cbi_v: int | None, gi_v: int | None, price_pct: float | None) -> dict[str, Any]:
    """BSOCIAL: 0.30 liquidity + 0.25 price momentum + 0.20 GI + 0.25 CBI. Liquidity has no source here, so the grade
    exists only when a price trend is typed (then 70% of the weight is covered)."""
    if price_pct is None or cbi_v is None or gi_v is None:
        return {"grade": None, "why": "Needs a price trend (typed) and market liquidity (no source connected) to grade fairly."}
    pm = te(price_pct, -10, 40) * 100
    v = (pm * 0.25 + gi_v * 0.2 + cbi_v * 0.25) / 0.70 / 100
    g = "A+" if v >= 0.65 else "A" if v >= 0.55 else "B+" if v >= 0.45 else "B" if v >= 0.35 else "C"
    return {"grade": g, "value": round(v * 100), "coverage": 0.7, "why": "From CBI, GI and your price trend; market liquidity (30% of the grade) has no source and is left out."}


# ---- fetching ----
def census_query(lat: float, lng: float, r: int) -> str:
    a = f"(around:{r},{lat:.6f},{lng:.6f})"
    return (f'[out:json][timeout:90];(nwr["amenity"]{a};nwr["shop"]{a};nwr["leisure"]{a};nwr["office"]{a};nwr["coworking"="yes"]{a};);out tags center;')


def history_query(lat: float, lng: float, date_iso: str | None) -> str:
    a = f"(around:{RADIUS_M},{lat:.6f},{lng:.6f})"
    ring = f"(around:{RING_RADIUS_M},{lat:.6f},{lng:.6f})"
    prem_a = "|".join(sorted(PREMIUM_VALUES | {"coworking_space"}))
    prem_s = "|".join(sorted(PREMIUM_VALUES))
    date = f'[date:"{date_iso}"]' if date_iso else ""
    return (f'[out:json][timeout:120]{date};'
            f'(nwr["amenity"]{a};nwr["shop"]{a};nwr["leisure"]{a};nwr["office"]{a};)->.all;.all out count;'
            f'(nwr["amenity"~"^({prem_a})$"]{a};nwr["shop"~"^({prem_s})$"]{a};nwr["office"~"^(coworking|coworking_space)$"]{a};)->.prem;.prem out count;'
            f'(nwr["amenity"~"^(cafe|restaurant|fast_food)$"]{a};)->.food;.food out count;'
            f'(nwr["amenity"]{ring};nwr["shop"]{ring};nwr["leisure"]{ring};nwr["office"]{ring};)->.ring;.ring out count;')


def months_ago_iso(months: int, now: float) -> str:
    d = datetime.fromtimestamp(now, timezone.utc)
    y, m = d.year, d.month - months
    while m <= 0:
        m += 12; y -= 1
    return f"{y:04d}-{m:02d}-01T00:00:00Z"


def area_feed_url(name: str, city: str | None) -> str:
    q = f'"{name}"' + (f" {city}" if city and city.lower() not in name.lower() else "") + " when:30d"
    return "https://news.google.com/rss/search?q=" + httpx.QueryParams({"q": q})["q"].replace(" ", "+") + "&hl=en-IN&gl=IN&ceid=IN:en"


class Gentrification:
    def __init__(self, osm: Any, history: Any, cells: Any = None, fixtures: Any = None) -> None:
        self.osm, self.history, self.cells, self.fixtures = osm, history, cells, fixtures
        self.cache = osm.cache
        self._jobs: dict[str, asyncio.Task] = {}

    def _job(self, key: str, make) -> asyncio.Task:
        t = self._jobs.get(key)
        if t is None or t.done():
            t = asyncio.ensure_future(make())
            self._jobs[key] = t
            t.add_done_callback(lambda _t: self._jobs.pop(key, None) if self._jobs.get(key) is _t else None)
        return t

    # one compact census per H3 res-7 cell: [[lat, lng, bits], ...]
    async def census(self, cell7: str, wait: bool = True) -> dict[str, Any] | None:
        import h3
        key = f"gentri:census:{cell7}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        failed = self.cache.get(f"{key}:failed")
        if failed is not None:
            return {"failed": True, "error": failed}

        async def fetch() -> dict[str, Any] | None:
            try:
                return await _fetch()
            except Exception as e:  # remembered for a while; the panel says so instead of retrying
                log.warning("gentrification census %s failed: %s: %s", cell7, type(e).__name__, str(e)[:200])
                self.cache.set(f"{key}:failed", f"{type(e).__name__}: {str(e)[:120]}", FAIL_TTL_S)
                return {"failed": True, "error": f"{type(e).__name__}"}

        async def _fetch() -> dict[str, Any]:
            lat, lng = h3.cell_to_latlng(cell7)
            data = await self.osm.raw(census_query(lat, lng, CENSUS_RADIUS_M), f"overpass_census_{cell7}" if self.fixtures is None else self._fixture_key("overpass_census", cell7), timeout_s=90)
            pts = []
            for el in data.get("elements", []):
                p_lat = el.get("lat") if el.get("lat") is not None else (el.get("center") or {}).get("lat")
                p_lng = el.get("lon") if el.get("lon") is not None else (el.get("center") or {}).get("lon")
                if p_lat is None or p_lng is None:
                    continue
                pts.append([round(p_lat, 6), round(p_lng, 6), classify(el.get("tags") or {})])
            out = {"cell": cell7, "lat": lat, "lng": lng, "radiusM": CENSUS_RADIUS_M, "points": pts, "fetchedAt": int(time.time() * 1000), "source": "OpenStreetMap via Overpass"}
            self.cache.set(key, out, CENSUS_TTL_S)
            return out

        task = self._job(key, fetch)
        if not wait:
            return None
        try:
            return await asyncio.wait_for(asyncio.shield(task), WAIT_S)
        except asyncio.TimeoutError:
            return None

    def _fixture_key(self, base: str, cell: str) -> str:
        f = self.fixtures / f"{base}_{cell}.json"
        return f"{base}_{cell}" if f.exists() else f"{base}_default"

    async def history_series(self, cell8: str, now: float, wait: bool = True) -> dict[str, Any] | None:
        import h3
        key = f"gentri:history:{cell8}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        if self.cache.get(f"{key}:failed") is not None:
            return {"failed": True}

        async def fetch() -> dict[str, Any] | None:
            try:
                return await _fetch()
            except Exception as e:
                log.warning("gentrification history %s failed: %s: %s", cell8, type(e).__name__, str(e)[:200])
                self.cache.set(f"{key}:failed", f"{type(e).__name__}", FAIL_TTL_S)
                return {"failed": True}

        async def _fetch() -> dict[str, Any]:
            lat, lng = h3.cell_to_latlng(cell8)
            rows = []
            for m in HISTORY_MONTHS:
                iso = None if m == 0 else months_ago_iso(m, now)
                fk = (f"overpass_history_{cell8}_{m}" if self.fixtures is None else (f"overpass_history_{m}" if (self.fixtures / f"overpass_history_{m}.json").exists() else "overpass_history_default"))
                data = await self.osm.raw(history_query(lat, lng, iso), fk, timeout_s=120)
                counts = [int((el.get("tags") or {}).get("total", 0)) for el in data.get("elements", []) if el.get("type") == "count"]
                if len(counts) < 4:
                    raise RuntimeError("Overpass history answered without the four counts")
                rows.append({"monthsAgo": m, "date": iso or "now", "total": counts[0], "premium": counts[1], "food": counts[2], "ring": counts[3]})
            out = {"cell": cell8, "rows": rows, "fetchedAt": int(time.time() * 1000), "source": "OpenStreetMap history via Overpass ([date:...] queries)"}
            self.cache.set(key, out, HISTORY_TTL_S)
            return out

        task = self._job(key, fetch)
        if not wait:
            return None
        try:
            return await asyncio.wait_for(asyncio.shield(task), 3.0)
        except asyncio.TimeoutError:
            return None

    async def news_mentions(self, name: str | None, lng: float, lat: float) -> dict[str, Any] | None:
        if not name:
            return None
        c = city_for(lng, lat, max_km=60)
        city = c[0] if c else None
        key = f"gentri:news:{name.lower()}:{city or ''}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        try:
            if self.fixtures is not None:
                f = self.fixtures / "news_area_default.xml"
                text = f.read_text() if f.exists() else ""
            else:
                async with http_client(httpx.Timeout(10.0)) as cl:
                    r = await cl.get(area_feed_url(name, city))
                    r.raise_for_status()
                    text = r.text
            items = parse_feed(text)
            cutoff = time.time() - 30 * 86400
            n = sum(1 for it in items if it["ts"] >= cutoff and name.lower().split(",")[0].strip() in it["title"].lower())
            out = {"name": name, "city": city, "mentions": n, "sample": [{"title": it["title"], "publisher": it["publisher"], "link": it["link"]} for it in items[:3]], "fetchedAt": int(time.time() * 1000)}
            self.cache.set(key, out, NEWS_TTL_S)
            return out
        except Exception as e:
            log.warning("news mentions for %s failed: %s", name, e)
            return None

    async def area_name(self, lng: float, lat: float) -> str | None:
        if self.cells is None:
            return None
        from .tiles import BBox
        d = 0.02
        try:
            ents = await self.cells.entities_in(BBox(lng - d, lat - d, lng + d, lat + d), cached_only=True)
        except Exception:
            return None
        best = None
        kx = 111.32 * math.cos(math.radians(lat))
        for e in ents:
            p = e.get("properties") or {}
            if not p.get("place") or e.get("geometry", {}).get("type") != "Point":
                continue
            x, y = e["geometry"]["coordinates"]
            dk = math.hypot((x - lng) * kx, (y - lat) * 110.57)
            if dk <= 2.5 and (best is None or dk < best[0]):
                best = (dk, p.get("name"))
        return best[1] if best else None

    def crimes_90d(self, lng: float, lat: float, now: float) -> int:
        d_lat = RADIUS_M / 110_570.0
        d_lng = RADIUS_M / (111_320.0 * math.cos(math.radians(lat)))
        try:
            return len(self.history.reports_in_bbox(lng - d_lng, lat - d_lat, lng + d_lng, lat + d_lat, since_s=90 * 86400, now=now, limit=1000))
        except Exception:
            return 0

    def _neighbours(self, census: dict[str, Any], lng: float, lat: float, here: str) -> list[dict[str, Any]]:
        import h3
        out = []
        for c in h3.grid_disk(here, 1):
            if c == here:
                continue
            clat, clng = h3.cell_to_latlng(c)
            d_m = math.hypot((clng - census["lng"]) * 111_320 * math.cos(math.radians(clat)), (clat - census["lat"]) * 110_570)
            if d_m + RADIUS_M > census["radiusM"]:
                continue  # its 1 km circle is not fully inside what was fetched
            cnt = counts_within(census["points"], clng, clat)
            comp = components(cnt, None, None)
            g = gi(cnt, comp)
            dist = math.hypot((clng - lng) * 111.32 * math.cos(math.radians(lat)), (clat - lat) * 110.57)
            out.append({"cell": c, "centre": {"lng": round(clng, 5), "lat": round(clat, 5)}, "gi": g["value"], "class": g["class"], "cbi": cbi(comp)["value"], "distanceKm": round(dist, 2), "spillover": round(math.exp(-dist / 1.5), 2),
                        "boundary": [[round(b, 6), round(a, 6)] for a, b in h3.cell_to_boundary(c)]})
        return out

    async def report(self, lng: float, lat: float, name: str | None = None, price_trend: float | None = None, now: float | None = None) -> dict[str, Any]:
        import h3
        now = time.time() if now is None else now
        cell8 = h3.latlng_to_cell(lat, lng, 8)
        cell7 = h3.cell_to_parent(cell8, 7)
        name = name or await self.area_name(lng, lat)
        census_t = asyncio.ensure_future(self.census(cell7))
        news_t = asyncio.ensure_future(self.news_mentions(name, lng, lat))
        census, news = await census_t, await news_t
        hist = await self.history_series(cell8, now)
        if census is None:
            return {"status": "pending", "retryInS": 5, "name": name, "message": "Counting the mapped places around this spot (OpenStreetMap); this takes a few seconds the first time."}
        if census.get("failed"):
            raise HTTPException(503, "OpenStreetMap places did not answer for this area just now; try again in a few minutes.")
        cnt = counts_within(census["points"], lng, lat)
        crimes = self.crimes_90d(lng, lat, now)
        comp = components(cnt, news["mentions"] if news else None, crimes)
        c = cbi(comp)
        g = gi(cnt, comp, price_trend)
        neigh = self._neighbours(census, lng, lat, cell8)
        weights = [n["spillover"] for n in neigh if n["gi"] is not None]
        spill = round(sum(n["spillover"] * n["gi"] for n in neigh if n["gi"] is not None) / sum(weights)) if weights and sum(weights) else None
        momentum: dict[str, Any] = {"status": "pending", "message": "Reading two years of OpenStreetMap history; it appears in a minute."}
        if hist and hist.get("failed"):
            momentum = {"status": "unavailable", "message": "OpenStreetMap history did not answer for this area; it is tried again in about 15 minutes."}
            hist = None
        if hist:
            rows = sorted(hist["rows"], key=lambda r: -r["monthsAgo"])
            base_ring = rows[0]["ring"] or 1
            adj = [r["premium"] * base_ring / (r["ring"] or 1) for r in rows]   # premium places, with the ring's mapping growth taken out
            xs = [-(r["monthsAgo"]) for r in rows]
            first, last = rows[0], rows[-1]
            area_g = (last["total"] / first["total"] - 1) if first["total"] else None
            ring_g = (last["ring"] / first["ring"] - 1) if first["ring"] else None
            momentum = {"status": "ok", "series": [{"monthsAgo": r["monthsAgo"], "date": r["date"], "total": r["total"], "premium": r["premium"], "food": r["food"], "ring": r["ring"], "premiumAdjusted": round(a, 1)} for r, a in zip(rows, adj)],
                        "areaGrowth": None if area_g is None else round(area_g * 100, 1), "ringGrowth": None if ring_g is None else round(ring_g * 100, 1),
                        "premiumFrom": first["premium"], "premiumTo": last["premium"], "trend": trend(adj), "projection": project(xs, adj),
                        "class": "derived", "source": hist["source"], "fetchedAt": hist["fetchedAt"],
                        "caveat": "Counts what people mapped, which grows as mapping improves; the 5 km ring's growth is taken out. It is not a price."}
        arch = archetypes(comp)
        fresh = 1.0 if now * 1000 - census["fetchedAt"] < CENSUS_TTL_S * 1000 else 0.7
        conf = round(g["coverage"] * fresh, 2)
        prov = [{"source": census["source"], "timestamp": census["fetchedAt"], "resolution": f"places within {RADIUS_M} m", "count": cnt["total"]}]
        if news:
            prov.append({"source": "Google News RSS", "timestamp": news["fetchedAt"], "resolution": f"headlines naming {news['name']}, 30 days", "count": news["mentions"]})
        if hist:
            prov.append({"source": hist["source"], "timestamp": hist["fetchedAt"], "resolution": f"{len(hist['rows'])} dates over 24 months", "count": None})
        prov.append({"source": "City Atlas reports + news crimes", "timestamp": int(now * 1000), "resolution": f"within {RADIUS_M} m, 90 days", "count": crimes})
        return {
            "status": "ok", "name": name, "centre": {"lng": lng, "lat": lat}, "cell": cell8, "counts": {k: cnt[k] for k in ("total",) + KEYS},
            "cbi": {**c, "components": [{"key": k, "weight": CBI_WEIGHTS[k], **comp[k]} for k in CBI_WEIGHTS]},
            "gi": g, "archetypes": arch, "momentum": momentum,
            "neighbours": neigh, "spillover": spill, "advisory": advisory(c["value"], g["value"], g["coverage"], neigh, crimes),
            "developerGrade": developer_grade(c["value"], g["value"], price_trend),
            "incidents90d": crimes, "news": news,
            "missing": [m for m in ("priceMomentum" if price_trend is None else None, "rentalTurnover", "liquidity", "households", "income") if m],
            "evidence": {"classification": "derived", "confidence": conf, "provenance": prov, "computedAt": int(now * 1000),
                         "model": "BSOCIAL CBI/GI/archetype formulas on mapped places, headlines and reported crime; parts with no real source are left out and the rest re-weighted"},
        }

    async def grid(self, bbox: tuple[float, float, float, float], limit: int = 220) -> dict[str, Any]:
        import h3
        w, s, e, n = bbox
        poly = h3.LatLngPoly([(s, w), (s, e), (n, e), (n, w)])
        ids = sorted(h3.polygon_to_cells(poly, 8))[:limit]
        out, missing = [], set()
        by_parent: dict[str, dict[str, Any] | None] = {}
        for c in ids:
            p = h3.cell_to_parent(c, 7)
            if p not in by_parent:
                by_parent[p] = self.cache.get(f"gentri:census:{p}")
                if by_parent[p] is None and self.cache.get(f"gentri:census:{p}:failed") is None:
                    missing.add(p)
            cen = by_parent[p]
            if cen is None:
                continue
            lat, lng = h3.cell_to_latlng(c)
            cnt = counts_within(cen["points"], lng, lat)
            if cnt["total"] == 0:
                continue
            comp = components(cnt, None, None)
            g = gi(cnt, comp)
            out.append({"cell": c, "gi": g["value"], "class": g["class"], "places": cnt["total"], "boundary": [[round(b, 6), round(a, 6)] for a, b in h3.cell_to_boundary(c)]})
        for p in list(missing)[:3]:  # fetch a few in the background; the layer fills in as they arrive
            asyncio.ensure_future(self.census(p, wait=False))
        return {"cells": out, "pending": len(missing), "computedAt": int(time.time() * 1000),
                "evidence": {"classification": "derived", "source": "OpenStreetMap via Overpass", "model": "amenity-premium part of the Gentrification Index per H3 cell (price, rent and buzz are not in the layer)"}}


def register(app: FastAPI, engine: Gentrification) -> None:
    @app.get("/api/gentrification")
    async def gentrification(lng: float = Query(..., ge=60, le=100), lat: float = Query(..., ge=5, le=38), name: str | None = Query(None, max_length=80), price_trend: float | None = Query(None, ge=-50, le=100)) -> dict[str, Any]:
        """Gentrification for the 1 km around a point in India: CBI, GI, archetype, two years of mapped-place momentum, advisory."""
        return await engine.report(lng, lat, name=(name or "").strip() or None, price_trend=price_trend)

    @app.get("/api/gentrification/grid")
    async def gentrification_grid(bbox: str = Query(..., pattern=r"^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$")) -> dict[str, Any]:
        w, s, e, n = (float(v) for v in bbox.split(","))
        if not (w < e and s < n) or (e - w) * (n - s) > MAX_GRID_DEG2:
            raise HTTPException(400, "bbox must be a small box (at most about 0.05 square degrees)")
        return await engine.grid((w, s, e, n))
