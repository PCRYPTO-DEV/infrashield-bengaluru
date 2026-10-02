"""Atlas Infinity server: real geography, live feeds and the AI writer behind one origin."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .cache import Cache
from .config import WEB_DIST, settings
from .osm import OverpassClient
from .regions import REGIONS


def create_app(cache: Cache | None = None, fixtures: Path | None = None, writer=None, history=None, alert_sender=None) -> FastAPI:
    cache = cache or Cache(settings.db_path)
    fixtures = fixtures if fixtures is not None else settings.fixtures
    osm = OverpassClient(cache, fixtures)
    from .memory import History, register as register_memory
    from .alerts import AlertEngine, register as register_alerts, twilio_from_env
    history = history or History(cache.path)
    alerts = AlertEngine(cache.path, history, twilio_from_env(), sender=alert_sender)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Baseline recorder: keeps the memory growing when nobody is watching. Live keys only; fixtures never spend.
        task = None
        if fixtures is None and settings.tomtom_api_key and settings.baseline_tiles:
            async def baseline():
                tiles = [t.strip() for t in settings.baseline_tiles.split(",") if t.strip()]
                while True:
                    for t in tiles:
                        try:
                            z, x, y = (int(v) for v in t.split("/"))
                            await app.state.tomtom.flow_tile(z, x, y)
                        except Exception as e:  # budget, network: try again next round
                            logging.getLogger("atlas.baseline").warning("baseline %s: %s", t, e)
                    await asyncio.sleep(max(60, settings.baseline_minutes * 60))
            task = asyncio.create_task(baseline())
        warm = None
        if fixtures is None and settings.warm_radius > 0:
            async def warm_up():
                await asyncio.sleep(3)
                o = REGIONS.get(settings.region, REGIONS["ncr"])["origin"]
                await osm.warm(o["lng"], o["lat"], settings.warm_radius)
                logging.getLogger("atlas.osm").info("warm-up done: %d tiles cached", osm.warmed)
            warm = asyncio.create_task(warm_up())
        yield
        if task:
            task.cancel()
        if warm:
            warm.cancel()

    app = FastAPI(title="Atlas Infinity", version="0.2.0", lifespan=lifespan)
    app.state.cache = cache
    app.state.osm = osm
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"], allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])

    @app.get("/api/health")
    async def health():
        return {"ok": True, "region": settings.region, "fixtures": fixtures is not None,
                "tomtom": bool(settings.tomtom_api_key), "writer": bool(settings.anthropic_api_key),
                "memory": history.count("flow_readings"), "alerts": bool(alerts.twilio),
                "osm": {"endpoint": osm.url, "calls": osm.live_calls, "tilesWarmed": osm.warmed, "lastError": osm.last_error}}

    @app.get("/api/regions")
    async def regions():
        return {"default": settings.region, "regions": REGIONS}

    @app.get("/api/tiles/osm/{z}/{x}/{y}.json")
    async def osm_tile(z: int, x: int, y: int, tier: str = Query("street", pattern="^(street|district)$")):
        if z not in (13, 16):
            raise HTTPException(400, "street tiles are zoom 16, district tiles zoom 13")
        try:
            return await osm.tile(z, x, y, tier)
        except LookupError as e:
            raise HTTPException(404, str(e))
        except Exception as e:  # Overpass down, timeout, policy block
            raise HTTPException(503, f"OpenStreetMap unavailable: {type(e).__name__}: {e}")

    from .tomtom import register as register_tomtom
    from .weather import register as register_weather
    from .explain import register as register_explain
    register_tomtom(app, cache, fixtures, history)
    register_memory(app, history)
    register_alerts(app, alerts)
    register_weather(app, cache, fixtures)
    register_explain(app, writer=writer, fake=fixtures is not None and not settings.anthropic_api_key)

    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            candidate = WEB_DIST / path
            if path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(WEB_DIST / "index.html")

    return app


app = create_app()
