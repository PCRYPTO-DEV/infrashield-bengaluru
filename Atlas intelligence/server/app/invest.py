"""
City Atlas Pro: UINTEL+ INVEST score. "Is this location a good idea?" as one 0-100 score with a grade,
from five signals weighted as in the UINTEL+ deck: Yield 30%, FSI Gap 20%, Distress Radar 20%,
Supply Pipeline 15%, Infrastructure 15%.

Every signal comes from something real, or it is "no data":
- Yield: the person's own asking price and rent (no price or rent source is connected), labelled as theirs.
- FSI Gap: built floor area from mapped buildings (OpenStreetMap footprints x floors) against the permitted
  FAR the person types from the master plan. Without it, only the built FAR is shown.
- Distress Radar: news headlines naming the area with auction, insolvency, SARFAESI, NCLT, stalled-project words.
- Supply Pipeline: construction sites mapped in OpenStreetMap within 1.5 km (fewer competing projects scores higher).
- Infrastructure: the place card's own transport, connectivity, walkability and service dimensions.

Below half the weight covered there is no score: the card says what to add. It is information, not
investment advice; it never says buy or sell.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query

from .access import pro_only

from .cells import ring_area_m2
from .gentrification import te
from .news import city_for, parse_feed
from .osm import http_client

log = logging.getLogger("atlas.invest")

WEIGHTS = {"yield": 0.30, "fsiGap": 0.20, "distress": 0.20, "supply": 0.15, "infrastructure": 0.15}
PURPOSES = ("investment", "office", "home", "retail", "risk")
# gross yield (% a year) that maps to 0 and to 100, by purpose: Indian homes rent at about 2-4%, offices and shops higher
YIELD_BANDS = {"investment": (1.5, 5.0), "home": (1.5, 5.0), "office": (4.0, 10.0), "retail": (4.0, 10.0), "risk": (1.5, 6.0)}
# which place-card dimensions make up "infrastructure" for each purpose, and how much each counts
INFRA_MIX = {
    "investment": {"access_transport": 1.0, "connectivity": 1.0, "access_school": 0.5, "access_health": 0.5, "walkability": 0.5},
    "home": {"access_school": 1.0, "access_health": 1.0, "access_transport": 0.75, "walkability": 0.75, "green": 0.5},
    "office": {"access_transport": 1.5, "connectivity": 1.0, "walkability": 0.5, "shopping": 0.5},
    "retail": {"walkability": 1.0, "access_transport": 1.0, "shopping": 1.0, "connectivity": 0.5},
    "risk": {"access_transport": 1.0, "connectivity": 1.0, "access_health": 0.5, "access_fire": 0.5, "access_police": 0.5},
}
BUILT_RADIUS_M = 250.0
SUPPLY_RADIUS_M = 1500
SUPPLY_TTL_S = 7 * 86400
DISTRESS_TTL_S = 12 * 3600
FAIL_TTL_S = 900
DISTRESS_WORDS = ("auction", "e-auction", "sarfaesi", "nclt", "insolvency", "bankrupt", "distress sale", "possession notice", "stalled", "defaulted", "default", "attached property", "liquidat")
DISTRESS = re.compile("|".join(re.escape(w) for w in DISTRESS_WORDS), re.I)


def grade(score: float | None) -> str | None:
    if score is None:
        return None
    return "A+" if score >= 85 else "A" if score >= 70 else "B" if score >= 55 else "C" if score >= 40 else "D"


def yield_signal(purpose: str, price: float | None, rent: float | None) -> dict[str, Any]:
    if not price or not rent or price <= 0 or rent <= 0:
        return {"score": None, "class": None, "confidence": None, "why": ["No rent or price source is connected. Type the asking price and the monthly rent (same unit) to include yield."], "value": None}
    y = rent * 12 / price * 100
    lo, hi = YIELD_BANDS[purpose]
    return {"score": round(te(y, lo, hi) * 100, 1), "class": "your figure", "confidence": 0.8, "value": round(y, 2),
            "why": [f"Gross yield {y:.2f}% a year from your figures (rent × 12 ÷ price). For {purpose}, {lo}% scores 0 and {hi}% scores 100."]}


def fsi_signal(built_far: float | None, built_info: dict[str, Any], permitted: float | None) -> dict[str, Any]:
    if built_far is None:
        return {"score": None, "class": None, "confidence": None, "value": None, "builtFar": None, "why": ["No mapped buildings are loaded within 250 m yet; zoom the map here and try again."]}
    known = built_info["floorsKnownShare"]
    base = [f"Built FAR about {built_far:.2f}: {built_info['buildings']} mapped buildings within {int(BUILT_RADIUS_M)} m, {round(built_info['floorAreaM2'])} m² of floor area on {round(built_info['landM2'])} m² of land; floors known for {round(known * 100)}% (others counted as 1 floor, so this is a low estimate)."]
    if not permitted or permitted <= 0:
        return {"score": None, "class": None, "confidence": None, "value": None, "builtFar": round(built_far, 2), "why": base + ["Type the permitted FAR from the master plan for this plot to see the gap."]}
    gap = max(0.0, permitted - built_far) / permitted
    return {"score": round(te(gap, 0.0, 0.7) * 100, 1), "class": "derived", "confidence": round(0.4 + 0.4 * known, 2), "value": round(gap * 100, 1), "builtFar": round(built_far, 2),
            "why": base + [f"Your permitted FAR {permitted:g}: about {round(gap * 100)}% of it is unused around here (more unused = more room to build)."]}


def distress_signal(d: dict[str, Any] | None) -> dict[str, Any]:
    if d is None:
        return {"score": None, "class": None, "confidence": None, "value": None, "why": ["No area name to search headlines for; search the place by name."], "items": []}
    if d.get("failed"):
        return {"score": None, "class": None, "confidence": None, "value": None, "why": ["The news search did not answer just now."], "items": []}
    n = d["hits"]
    return {"score": round(te(n, 0, 6) * 100, 1), "class": "observed", "confidence": 0.35 if n == 0 else 0.5, "value": n, "items": d["items"][:4],
            "why": [f"{n} headlines in 6 months name {d['name']} with auction, insolvency, SARFAESI, NCLT or stalled-project words (Google News). More distress means more motivated sellers; none found is not proof of none."]}


def supply_signal(s: dict[str, Any] | None) -> dict[str, Any]:
    if s is None or s.get("failed"):
        return {"score": None, "class": None, "confidence": None, "value": None, "why": ["OpenStreetMap did not answer for construction sites just now." if s else "Counting construction sites (OpenStreetMap)…"]}
    n = s["sites"]
    return {"score": round((1 - te(n, 0, 25)) * 100, 1), "class": "derived", "confidence": 0.45, "value": n,
            "why": [f"{n} construction sites mapped within {SUPPLY_RADIUS_M / 1000:g} km (OpenStreetMap landuse or building = construction). Fewer competing projects score higher; unmapped sites are not counted."]}


def infra_signal(purpose: str, state: dict[str, Any] | None) -> dict[str, Any]:
    if not state:
        return {"score": None, "class": None, "confidence": None, "value": None, "why": ["Streets for this area are not loaded yet."], "parts": []}
    dims = {d["key"]: d for d in state.get("dimensions", [])}
    num = den = cnum = 0.0
    parts = []
    for k, w in INFRA_MIX[purpose].items():
        d = dims.get(k)
        if not d or d.get("score") is None:
            continue
        num += w * d["score"]; den += w; cnum += w * (d.get("confidence") or 0.5)
        parts.append({"key": k, "score": round(d["score"]), "why": (d.get("why") or [""])[0]})
    if not den:
        return {"score": None, "class": None, "confidence": None, "value": None, "why": ["The place card has no transport or service data here yet."], "parts": []}
    return {"score": round(num / den, 1), "class": "derived", "confidence": round(cnum / den, 2), "value": None, "parts": parts,
            "why": ["From the place card: " + ", ".join(p["key"].replace("access_", "").replace("_", " ") + f" {p['score']}" for p in parts) + "."]}


def combine(signals: dict[str, dict[str, Any]]) -> dict[str, Any]:
    num = den = cnum = 0.0
    for k, w in WEIGHTS.items():
        s = signals[k]
        if s["score"] is None:
            continue
        num += w * s["score"]; den += w; cnum += w * (s["confidence"] or 0.0)
    coverage = round(den, 2)
    score = round(num / den, 1) if den and coverage >= 0.5 else None
    return {"score": score, "grade": grade(score), "coverage": coverage, "confidence": round(cnum / den, 2) if den else 0.0,
            "partial": round(num / den, 1) if den and score is None else None}


def verdict(signals: dict[str, dict[str, Any]], score: float | None) -> list[str]:
    """Plain sentences built only from signals that have data; never 'buy' or 'sell'."""
    out = []
    y, f, d, s, i = (signals[k] for k in ("yield", "fsiGap", "distress", "supply", "infrastructure"))
    if y["score"] is not None:
        out.append("Rent pays well for the price." if y["score"] >= 65 else "Rent is modest for the price." if y["score"] >= 35 else "Rent is low for the price: a capital-growth bet, not an income one.")
    if i["score"] is not None:
        out.append("Well connected." if i["score"] >= 65 else "Connections are average." if i["score"] >= 40 else "Connections are weak here.")
    if s["value"] is not None:
        out.append("Lots of building going on nearby: more competing space ahead." if s["value"] >= 15 else "Some construction nearby." if s["value"] >= 5 else "Little construction mapped nearby.")
    if d["value"] is not None:
        out.append("Several distress headlines: motivated sellers may exist; check each case." if d["value"] >= 3 else "No distress headlines found; expect market prices." if d["value"] == 0 else "A few distress headlines.")
    if f["score"] is not None:
        out.append("Plenty of unused building rights." if f["score"] >= 60 else "Some unused building rights." if f["score"] >= 30 else "Little room left to build.")
    if score is None:
        out.append("Not enough real data for a score yet: add price and rent, or the permitted FAR.")
    return out


class Invest:
    def __init__(self, osm: Any, cells: Any, gentri: Any, fixtures: Any = None) -> None:
        self.osm, self.cells, self.gentri, self.fixtures = osm, cells, gentri, fixtures
        self.cache = osm.cache
        self._jobs: dict[str, asyncio.Task] = {}

    async def built_far(self, lng: float, lat: float) -> tuple[float | None, dict[str, Any]]:
        from .tiles import BBox
        d_lat = BUILT_RADIUS_M / 110_570.0
        d_lng = BUILT_RADIUS_M / (111_320.0 * math.cos(math.radians(lat)))
        try:
            ents = await self.cells.entities_in(BBox(lng - d_lng, lat - d_lat, lng + d_lng, lat + d_lat))
        except Exception:
            ents = []
        kx = 111_320.0 * math.cos(math.radians(lat))
        floor_area = 0.0; n = 0; known = 0
        for e in ents:
            if e.get("type") != "building" or e.get("geometry", {}).get("type") != "Polygon":
                continue
            ring = e["geometry"]["coordinates"][0]
            cx = sum(p[0] for p in ring) / len(ring); cy = sum(p[1] for p in ring) / len(ring)
            if math.hypot((cx - lng) * kx, (cy - lat) * 110_570.0) > BUILT_RADIUS_M:
                continue
            p = e.get("properties") or {}
            fl = max(1, int(p.get("floors") or 1))
            floor_area += ring_area_m2(ring, lat) * fl
            n += 1
            known += 1 if p.get("floorsSource") in ("osm:building:levels", "osm:height") else 0
        land = math.pi * BUILT_RADIUS_M ** 2
        info = {"buildings": n, "floorAreaM2": floor_area, "landM2": land, "floorsKnownShare": (known / n) if n else 0.0}
        return (floor_area / land if n else None), info

    async def supply(self, lng: float, lat: float) -> dict[str, Any] | None:
        import h3
        cell = h3.latlng_to_cell(lat, lng, 8)
        key = f"invest:supply:{cell}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        if self.cache.get(f"{key}:failed") is not None:
            return {"failed": True}

        async def fetch() -> dict[str, Any]:
            clat, clng = h3.cell_to_latlng(cell)
            a = f"(around:{SUPPLY_RADIUS_M},{clat:.6f},{clng:.6f})"
            q = f'[out:json][timeout:60];(nwr["landuse"="construction"]{a};nwr["building"="construction"]{a};);out count;'
            try:
                fk = f"overpass_construction_{cell}" if self.fixtures is None else "overpass_construction_default"
                data = await self.osm.raw(q, fk, timeout_s=60)
                n = next((int((el.get("tags") or {}).get("total", 0)) for el in data.get("elements", []) if el.get("type") == "count"), 0)
                out = {"sites": n, "fetchedAt": int(time.time() * 1000), "source": "OpenStreetMap via Overpass"}
                self.cache.set(key, out, SUPPLY_TTL_S)
                return out
            except Exception as e:
                log.warning("invest supply %s failed: %s: %s", cell, type(e).__name__, str(e)[:200])
                self.cache.set(f"{key}:failed", type(e).__name__, FAIL_TTL_S)
                return {"failed": True}

        t = self._jobs.get(key)
        if t is None or t.done():
            t = asyncio.ensure_future(fetch()); self._jobs[key] = t
        try:
            return await asyncio.wait_for(asyncio.shield(t), 12.0)
        except asyncio.TimeoutError:
            return None

    async def distress(self, name: str | None, lng: float, lat: float) -> dict[str, Any] | None:
        if not name:
            return None
        c = city_for(lng, lat, max_km=60)
        city = c[0] if c else None
        key = f"invest:distress:{name.lower()}:{city or ''}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        if self.cache.get(f"{key}:failed") is not None:
            return {"failed": True}
        try:
            if self.fixtures is not None:
                f = self.fixtures / "news_distress_default.xml"
                text = f.read_text() if f.exists() else ""
            else:
                q = f'"{name}"' + (f" {city}" if city and city.lower() not in name.lower() else "") + " (auction OR SARFAESI OR NCLT OR insolvency OR \"distress sale\" OR stalled OR \"possession notice\") when:180d"
                url = "https://news.google.com/rss/search?q=" + httpx.QueryParams({"q": q})["q"].replace(" ", "+") + "&hl=en-IN&gl=IN&ceid=IN:en"
                async with http_client(httpx.Timeout(10.0)) as cl:
                    r = await cl.get(url)
                    r.raise_for_status()
                    text = r.text
            cutoff = time.time() - 180 * 86400
            short = name.split(",")[0].strip().lower()
            items = [it for it in parse_feed(text) if it["ts"] >= cutoff and short in it["title"].lower() and DISTRESS.search(it["title"])]
            out = {"name": name, "hits": len(items), "items": [{"title": it["title"], "publisher": it["publisher"], "link": it["link"]} for it in items[:6]], "fetchedAt": int(time.time() * 1000)}
            self.cache.set(key, out, DISTRESS_TTL_S)
            return out
        except Exception as e:
            log.warning("invest distress for %s failed: %s", name, e)
            self.cache.set(f"{key}:failed", type(e).__name__, FAIL_TTL_S)
            return {"failed": True}

    async def report(self, lng: float, lat: float, purpose: str = "investment", name: str | None = None, price: float | None = None, rent: float | None = None,
                     permitted_far: float | None = None, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        name = name or (await self.gentri.area_name(lng, lat) if self.gentri else None)
        state_t = asyncio.ensure_future(self.cells.state(lng, lat, 9))
        far_t = asyncio.ensure_future(self.built_far(lng, lat))
        sup_t = asyncio.ensure_future(self.supply(lng, lat))
        dis_t = asyncio.ensure_future(self.distress(name, lng, lat))
        state = None
        try:
            state = await state_t
        except Exception as e:
            log.warning("invest place state failed: %s", e)
        far, far_info = await far_t
        sup, dis = await sup_t, await dis_t
        signals = {
            "yield": yield_signal(purpose, price, rent),
            "fsiGap": fsi_signal(far, far_info, permitted_far),
            "distress": distress_signal(dis),
            "supply": supply_signal(sup),
            "infrastructure": infra_signal(purpose, state),
        }
        total = combine(signals)
        prov = []
        if state:
            prov.append({"source": "City Atlas place card (OpenStreetMap)", "timestamp": int(now * 1000), "resolution": "H3 cell, services within 2.5 km", "count": None})
        if far is not None:
            prov.append({"source": "OpenStreetMap buildings", "timestamp": int(now * 1000), "resolution": f"within {int(BUILT_RADIUS_M)} m", "count": far_info["buildings"]})
        if sup and not sup.get("failed"):
            prov.append({"source": sup["source"], "timestamp": sup["fetchedAt"], "resolution": f"construction within {SUPPLY_RADIUS_M} m", "count": sup["sites"]})
        if dis and not dis.get("failed"):
            prov.append({"source": "Google News RSS", "timestamp": dis["fetchedAt"], "resolution": f"distress headlines naming {dis['name']}, 6 months", "count": dis["hits"]})
        if price and rent:
            prov.append({"source": "your figures", "timestamp": int(now * 1000), "resolution": "asking price and monthly rent", "count": None})
        if permitted_far:
            prov.append({"source": "your figure", "timestamp": int(now * 1000), "resolution": "permitted FAR", "count": None})
        return {
            "name": name, "centre": {"lng": lng, "lat": lat}, "purpose": purpose, **total,
            "signals": [{"key": k, "weight": w, **signals[k]} for k, w in WEIGHTS.items()],
            "verdict": verdict(signals, total["score"]),
            "missing": [k for k in WEIGHTS if signals[k]["score"] is None],
            "evidence": {"classification": "derived", "confidence": total["confidence"], "provenance": prov, "computedAt": int(now * 1000),
                         "model": "UINTEL+ weights (yield 30, FSI gap 20, distress 20, supply 15, infrastructure 15) over the signals that have real inputs; no score below half the weight"},
            "note": "Information to support your own judgement, not investment advice.",
        }


def register(app: FastAPI, engine: Invest) -> None:
    @app.get("/api/invest", dependencies=[Depends(pro_only)])
    async def invest(lng: float = Query(..., ge=60, le=100), lat: float = Query(..., ge=5, le=38), purpose: str = Query("investment", max_length=20),
                     name: str | None = Query(None, max_length=80), price: float | None = Query(None, gt=0, le=1e12), rent: float | None = Query(None, gt=0, le=1e10),
                     permitted_far: float | None = Query(None, gt=0, le=20)) -> dict[str, Any]:
        """UINTEL+ INVEST score for a spot in India, from real signals only."""
        if purpose not in PURPOSES:
            raise HTTPException(400, f"purpose must be one of {', '.join(PURPOSES)}")
        if engine.cells.weather is None:
            engine.cells.weather = getattr(app.state, "weather", None)
        return await engine.report(lng, lat, purpose, (name or "").strip() or None, price, rent, permitted_far)
