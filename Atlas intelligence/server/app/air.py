"""Air quality from Open-Meteo (free, no key; CAMS model at ~11 km). Observed · open-meteo-air."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from .cache import Cache
from .config import settings

AIR_TTL = 1800
FIELDS = "european_aqi,us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone"


def eu_band(aqi: float | None) -> str | None:
    if aqi is None:
        return None
    return "good" if aqi <= 20 else "fair" if aqi <= 40 else "moderate" if aqi <= 60 else "poor" if aqi <= 80 else "very poor" if aqi <= 100 else "extremely poor"


class AirClient:
    def __init__(self, cache: Cache, fixtures: Path | None = None, base: str | None = None, history: Any = None):
        self.cache = cache
        self.fixtures = fixtures
        self.base = base or settings.open_meteo_air_base
        self.history = history

    async def current(self, lat: float, lng: float) -> dict[str, Any]:
        lat_r, lng_r = round(lat, 2), round(lng, 2)
        key = f"air:{lat_r},{lng_r}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        now = time.time()
        if self.fixtures is not None:
            f = self.fixtures / "air.json"
            if not f.exists():
                raise LookupError("no air fixture")
            data = json.loads(f.read_text())
        else:
            from .osm import http_client
            async with http_client(httpx.Timeout(15.0, connect=8.0)) as client:
                r = await client.get(f"{self.base}/v1/air-quality", params={"latitude": lat, "longitude": lng, "current": FIELDS, "timezone": "UTC"})
                r.raise_for_status()
                data = r.json()
        cur = data.get("current") or {}
        result = {
            "fetchedAt": int(now * 1000), "source": "open-meteo-air", "observedAt": cur.get("time"),
            "euAqi": cur.get("european_aqi"), "usAqi": cur.get("us_aqi"), "pm25": cur.get("pm2_5"), "pm10": cur.get("pm10"),
            "no2": cur.get("nitrogen_dioxide"), "o3": cur.get("ozone"), "band": eu_band(cur.get("european_aqi")),
            "resolutionKm": 11,
            "evidence": {"classification": "observed", "source": "open-meteo-air", "timestamp": int(now * 1000), "confidence": 0.7},
        }
        self.cache.set(key, result, AIR_TTL, now)
        if self.history is not None and result["euAqi"] is not None:
            self.history.record_air(lat_r, lng_r, result, now)
        return result


def register(app: FastAPI, cache: Cache, fixtures: Path | None, history: Any = None) -> AirClient:
    client = AirClient(cache, fixtures, history=history)
    app.state.air = client

    @app.get("/api/air")
    async def air(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
        try:
            return await client.current(lat, lng)
        except LookupError as e:
            raise HTTPException(404, str(e))
        except Exception as e:
            raise HTTPException(503, f"air quality unavailable: {type(e).__name__}: {e}")

    return client
