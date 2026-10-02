"""Current weather from Open-Meteo (free, no key). Observed · open-meteo."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from .cache import Cache
from .config import settings

WEATHER_TTL = 600
WMO = {0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
       61: "Slight rain", 63: "Rain", 65: "Heavy rain", 80: "Rain showers", 81: "Rain showers", 82: "Violent showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail"}


class WeatherClient:
    def __init__(self, cache: Cache, fixtures: Path | None = None, base: str | None = None):
        self.cache = cache
        self.fixtures = fixtures
        self.base = base or settings.open_meteo_base

    async def current(self, lat: float, lng: float) -> dict[str, Any]:
        lat_r, lng_r = round(lat, 2), round(lng, 2)
        key = f"weather:{lat_r},{lng_r}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        if self.fixtures is not None:
            f = self.fixtures / f"weather_{lat_r}_{lng_r}.json"
            if not f.exists():
                f = self.fixtures / "weather_default.json"
            if not f.exists():
                raise LookupError("no weather fixture")
            data = json.loads(f.read_text())
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(self.base + "/v1/forecast", params={"latitude": lat_r, "longitude": lng_r, "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m", "timezone": "auto"})
                r.raise_for_status()
                data = r.json()
        now = time.time()
        c = data.get("current", {})
        code = c.get("weather_code")
        result = {"fetchedAt": int(now * 1000), "source": "open-meteo", "evidence": {"classification": "observed", "source": "open-meteo", "timestamp": int(now * 1000), "confidence": 0.9},
                  "temperatureC": c.get("temperature_2m"), "humidityPct": c.get("relative_humidity_2m"), "precipitationMm": c.get("precipitation"),
                  "windKmh": c.get("wind_speed_10m"), "weatherCode": code, "description": WMO.get(code, "Unknown") if code is not None else None, "observedAt": c.get("time")}
        self.cache.set(key, result, WEATHER_TTL, now)
        return result


def register(app: FastAPI, cache: Cache, fixtures: Path | None) -> None:
    client = WeatherClient(cache, fixtures)
    app.state.weather = client

    @app.get("/api/weather")
    async def weather(lat: float = Query(...), lng: float = Query(...)):
        try:
            return await client.current(lat, lng)
        except LookupError as e:
            raise HTTPException(404, str(e))
        except Exception as e:
            raise HTTPException(503, f"weather unavailable: {type(e).__name__}: {e}")
