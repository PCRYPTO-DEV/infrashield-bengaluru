"""
Crimes reported online. The server reads the public Google News RSS search for crime headlines in
the city on screen (last day), keeps each story for a day, and places it on the map only when the
headline names a locality the geocoder can find near that city. The place is approximate, and the
map draws it that way (a ring, not a point). Headlines without a locality are counted, not placed.
Nothing is invented: the headline, the publisher, the link and the time come straight from the feed.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx

from .osm import http_client

log = logging.getLogger("atlas.news")

KEEP_S = 86400
REFRESH_S = 900
# a few words a headline uses, and the kind it becomes
KINDS = [
    ("snatching", r"snatch\w*"), ("theft", r"\b(theft|thie\w+|stole|stolen|burglar\w*|rob\w+|loot\w*|chain)\b"), ("assault", r"\b(assault\w*|stab\w*|murder\w*|kill\w*|shot|shoot\w*|attack\w*|beat\w*|lynch\w*)\b"),
    ("harassment", r"\b(harass\w*|molest\w*|rape\w*|stalk\w*|eve.teas\w*)\b"), ("vandalism", r"\b(vandal\w*|arson|set (on )?fire|torch\w*)\b"), ("accident", r"\b(accident\w*|hit.and.run|mishap|collid\w*|crash\w*)\b"),
    ("suspicious", r"\b(suspicious|kidnap\w*|abduct\w*|extort\w*|fraud\w*|cheat\w*|drug\w*|smuggl\w*)\b"),
]
CRIME = re.compile("|".join(p for _, p in KINDS), re.I)
# "in Lajpat Nagar", "at Karol Bagh", "near Saket", "Rohini's" ...
PLACE = re.compile(r"\b(?:in|at|near|from|of|outside)\s+((?:[A-Z][A-Za-z'’\-]+\s?){1,3})")
STOP = {"Delhi", "New Delhi", "Mumbai", "India", "Police", "Court", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "The", "A", "An", "Two", "Three", "Man", "Woman", "Youth", "Cops", "Crime", "Branch", "Station", "Hospital", "Metro", "Road"}

CITIES: list[tuple[str, float, float]] = [
    ("Delhi", 77.2167, 28.6315), ("Gurugram", 77.0266, 28.4595), ("Noida", 77.3910, 28.5355), ("Ghaziabad", 77.4538, 28.6692), ("Faridabad", 77.3178, 28.4089),
    ("Mumbai", 72.8777, 19.0760), ("Pune", 73.8567, 18.5204), ("Bengaluru", 77.5946, 12.9716), ("Chennai", 80.2707, 13.0827), ("Hyderabad", 78.4867, 17.3850),
    ("Kolkata", 88.3639, 22.5726), ("Ahmedabad", 72.5714, 23.0225), ("Jaipur", 75.7873, 26.9124), ("Lucknow", 80.9462, 26.8467), ("Chandigarh", 76.7794, 30.7333),
    ("Bhopal", 77.4126, 23.2599), ("Indore", 75.8577, 22.7196), ("Patna", 85.1376, 25.5941), ("Kochi", 76.2673, 9.9312), ("Surat", 72.8311, 21.1702), ("Nagpur", 79.0882, 21.1458),
    ("Visakhapatnam", 83.2185, 17.6868), ("Guwahati", 91.7362, 26.1445), ("Bhubaneswar", 85.8245, 20.2961), ("Thiruvananthapuram", 76.9366, 8.5241), ("Dehradun", 78.0322, 30.3165),
]


def city_for(lng: float, lat: float, max_km: float = 45.0) -> tuple[str, float, float] | None:
    best = None
    for name, clng, clat in CITIES:
        d = math.hypot((lng - clng) * 111.32 * math.cos(math.radians(lat)), (lat - clat) * 110.57)
        if d <= max_km and (best is None or d < best[0]):
            best = (d, name, clng, clat)
    return (best[1], best[2], best[3]) if best else None


def feed_url(city: str) -> str:
    q = f"({city}) (snatching OR theft OR robbery OR murder OR assault OR stabbed OR molested OR arrested OR crime) when:1d"
    return "https://news.google.com/rss/search?q=" + httpx.QueryParams({"q": q})["q"].replace(" ", "+") + "&hl=en-IN&gl=IN&ceid=IN:en"


def parse_feed(xml_text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = item.findtext("pubDate") or ""
        src = item.find("source")
        publisher = (src.text or "").strip() if src is not None else ""
        try:
            ts = parsedate_to_datetime(pub).timestamp() if pub else time.time()
        except (TypeError, ValueError):
            ts = time.time()
        # Google puts " - Publisher" at the end of the title
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(publisher) - 3].strip()
        if title:
            out.append({"title": title, "link": link, "ts": ts, "publisher": publisher})
    return out


def kind_of(title: str) -> str | None:
    for kind, pat in KINDS:
        if re.search(pat, title, re.I):
            return kind
    return None


def place_candidates(title: str, city: str) -> list[str]:
    cands = []
    for m in PLACE.finditer(title):
        p = m.group(1).strip()
        words = [w for w in p.split() if w not in STOP and w.lower() != city.lower()]
        if words:
            cands.append(" ".join(words))
    # "Lajpat Nagar man held" style: a capitalised pair before a common noun
    for m in re.finditer(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:man|woman|youth|resident|cop|shopkeeper|student)\b", title):
        if m.group(1) not in STOP:
            cands.append(m.group(1))
    seen: list[str] = []
    for c in cands:
        if c not in seen:
            seen.append(c)
    return seen[:3]


class NewsCrime:
    """Fetches, places and stores crime headlines for a city; one refresh per city per 15 min."""

    def __init__(self, history: Any, tomtom: Any, fixtures: Path | None = None) -> None:
        self.history, self.tomtom, self.fixtures = history, tomtom, fixtures
        self.last: dict[str, float] = {}
        self.unplaced: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def fetch(self, city: str) -> str:
        if self.fixtures is not None:
            f = self.fixtures / f"news_{city.lower()}.xml"
            if not f.exists():
                f = self.fixtures / "news_default.xml"
            return f.read_text() if f.exists() else ""
        async with http_client(httpx.Timeout(12.0)) as c:
            r = await c.get(feed_url(city))
            r.raise_for_status()
            return r.text

    async def locate(self, title: str, city: str, clng: float, clat: float) -> tuple[float, float, float] | None:
        """lng, lat and a precision radius in metres, or None when no locality in the headline can be found near the city."""
        for cand in place_candidates(title, city):
            try:
                res = await self.tomtom.geocode(f"{cand}, {city}", clat, clng, limit=3)
            except Exception:
                continue
            for r in res:
                d_km = math.hypot((r["lng"] - clng) * 111.32 * math.cos(math.radians(clat)), (r["lat"] - clat) * 110.57)
                if d_km <= 45 and r.get("kind") not in ("Municipality", "Country", "CountrySubdivision"):
                    radius = 400.0 if r.get("kind") in ("Street", "POI", "Point Address", "Cross Street") else 1200.0
                    return r["lng"], r["lat"], radius
        return None

    async def refresh(self, lng: float, lat: float, force: bool = False) -> dict[str, Any] | None:
        c = city_for(lng, lat)
        if not c:
            return None
        city, clng, clat = c
        now = time.time()
        if not force and now - self.last.get(city, 0) < REFRESH_S:
            return {"city": city, "fresh": False}
        async with self._lock:
            if not force and now - self.last.get(city, 0) < REFRESH_S:
                return {"city": city, "fresh": False}
            self.last[city] = now
            try:
                items = parse_feed(await self.fetch(city))
            except Exception as e:  # the feed is optional; the map says when it is missing
                log.warning("news feed for %s failed: %s", city, e)
                return {"city": city, "fresh": False, "error": str(e)}
            placed = unplaced = 0
            for it in items:
                if now - it["ts"] > KEEP_S or not CRIME.search(it["title"]):
                    continue
                if self.history.has_report_url(it["link"]):
                    continue
                kind = kind_of(it["title"]) or "other"
                loc = await self.locate(it["title"], city, clng, clat)
                if not loc:
                    unplaced += 1
                    continue
                self.history.record_report(kind, it["title"][:200], loc[0], loc[1], "news", ts=it["ts"], source="news", url=it["link"], precision_m=loc[2], publisher=it["publisher"])
                placed += 1
            self.unplaced[city] = unplaced
            return {"city": city, "fresh": True, "placed": placed, "unplaced": unplaced, "items": len(items)}
