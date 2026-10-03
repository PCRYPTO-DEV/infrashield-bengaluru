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
        hot_task = None
        if fixtures is None and settings.tomtom_api_key:
            hot_task = asyncio.create_task(app.state.hot_poller())
        warm = None
        if fixtures is None and settings.warm_radius > 0:
            async def warm_up():
                await asyncio.sleep(3)
                o = REGIONS.get(settings.region, REGIONS["india"])["origin"]
                await osm.warm(o["lng"], o["lat"], settings.warm_radius)
                logging.getLogger("atlas.osm").info("warm-up done: %d tiles cached", osm.warmed)
            warm = asyncio.create_task(warm_up())
        yield
        if task:
            task.cancel()
        if warm:
            warm.cancel()
        if hot_task:
            hot_task.cancel()

    app = FastAPI(title="Atlas Infinity", version="0.2.0", lifespan=lifespan)
    app.state.cache = cache
    app.state.osm = osm
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"], allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])

    @app.get("/api/health")
    async def health():
        return {"ok": True, "region": settings.region, "fixtures": fixtures is not None,
                "tomtom": bool(settings.tomtom_api_key), "writer": bool(settings.anthropic_api_key),
                "memory": history.count("flow_readings"), "alerts": bool(alerts.twilio),
                "live": {"hotTiles": len(app.state.hot.hot()), "subscribers": len(app.state.broadcast.queues)},
                "osm": {"endpoint": osm.url, "source": "vector-tiles" if osm.vtiles else "overpass", "calls": osm.live_calls + (osm.vtiles.calls if osm.vtiles else 0), "tilesWarmed": osm.warmed, "lastError": osm.last_error or (osm.vtiles.last_error if osm.vtiles else None)}}

    @app.get("/api/regions")
    async def regions():
        return {"default": settings.region, "regions": REGIONS}

    @app.get("/api/diag/osm")
    async def diag_osm():
        """What the server's network does to each map source: DNS, status, latency, last error."""
        return {"ipv4Only": settings.ipv4_only, "lastError": osm.last_error, "calls": osm.live_calls, "tilesWarmed": osm.warmed, "sources": await osm.diagnose()}

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
    from .air import register as register_air
    from .cells import CellModel
    from .changes import ChangeEngine
    from .tiles import BBox
    register_tomtom(app, cache, fixtures, history)
    air = register_air(app, cache, fixtures, history)
    from .live import register as register_live
    broadcast, hot = register_live(app, history, app.state.tomtom, osm, fixtures is not None)
    app.state.tomtom.hot = hot
    register_memory(app, history)
    from .timemachine import register as register_timemachine
    register_timemachine(app, history)
    from .reports import register as register_reports
    from .news import NewsCrime
    news = NewsCrime(history, app.state.tomtom, fixtures)
    app.state.news = news
    register_reports(app, history, news)
    register_alerts(app, alerts)
    cells = CellModel(osm, history, None, air)
    app.state.cells = cells
    from .sites import register as register_sites
    register_sites(app, cells)
    from .gentrification import Gentrification, register as register_gentrification
    gentri = Gentrification(osm, history, cells, fixtures)
    app.state.gentrification = gentri
    register_gentrification(app, gentri)
    from .invest import Invest, register as register_invest
    app.state.invest = Invest(osm, cells, gentri, fixtures)
    register_invest(app, app.state.invest)
    changes = ChangeEngine(history, air)

    @app.get("/api/place")
    async def place(lng: float = Query(..., ge=-180, le=180), lat: float = Query(..., ge=-90, le=90), res: int = Query(9, ge=7, le=10), cached: bool = Query(False)):
        """Place intelligence: one H3 cell's state vector with WHY, confidence and provenance per dimension."""
        if cells.weather is None:
            cells.weather = getattr(app.state, "weather", None)
        return await cells.state(lng, lat, res, cached_only=cached)

    @app.get("/api/cells")
    async def cells_in(bbox: str = Query(..., pattern=r"^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$"), res: int = Query(9, ge=7, le=10), limit: int = Query(120, ge=1, le=400)):
        """Scores for the cells in a bbox, from cached tiles only (no network), for a city-level view."""
        import h3
        w, s_, e, n = (float(v) for v in bbox.split(","))
        if not (w < e and s_ < n) or (e - w) * (n - s_) > 0.05:
            raise HTTPException(400, "bbox must be a small box (at most about 0.05 square degrees, roughly 25 km x 20 km)")
        poly = h3.LatLngPoly([(s_, w), (s_, e), (n, e), (n, w)])
        ids = list(h3.polygon_to_cells(poly, res))[:limit]
        if cells.weather is None:
            cells.weather = getattr(app.state, "weather", None)
        out = []
        for cid in ids:
            la, ln = h3.cell_to_latlng(cid)
            st = await cells.state(ln, la, res, cached_only=True)
            if st["score"] is not None:
                out.append({"cell": cid, "centre": st["centre"], "boundary": st["boundary"], "score": st["score"], "band": st["band"], "confidence": st["confidence"]})
        return {"res": res, "cells": out, "considered": len(ids)}

    @app.get("/api/changes")
    async def what_changed(bbox: str = Query(..., pattern=r"^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$"), since: float = Query(86400, ge=600, le=30 * 86400), limit: int = Query(17, ge=1, le=50)):
        w, s_, e, n = (float(v) for v in bbox.split(","))
        return changes.detect(BBox(w, s_, e, n), since_s=since, limit=limit)
    register_weather(app, cache, fixtures)
    register_explain(app, writer=writer, fake=fixtures is not None and not settings.anthropic_api_key)

    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        dist_root = WEB_DIST.resolve()

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            # Unknown API paths are 404s, never the app page.
            if path.startswith("api/") or path == "api":
                raise HTTPException(404, "no such endpoint")
            # Only files inside web/dist are ever served: resolve and check the parent chain (no ..%2F tricks).
            candidate = (WEB_DIST / path).resolve()
            if candidate != dist_root and dist_root not in candidate.parents:
                raise HTTPException(404, "not found")
            if path and candidate.is_file():
                return FileResponse(candidate)
            # a folder with its own page (e.g. /integration/) is served as that page, not the app
            if path and (candidate / "index.html").is_file():
                return FileResponse(candidate / "index.html")
            return FileResponse(WEB_DIST / "index.html")

    return app


app = create_app()
