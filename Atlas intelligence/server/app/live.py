"""Live without lag: the server keeps the tiles people are looking at hot (polling TomTom itself, inside
the daily budget), pushes every fresh reading to every open browser over a server-sent event stream,
and warms a state's streets the moment someone chooses it. Nothing is predicted here; the stream only
carries what was just measured.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import StreamingResponse

log = logging.getLogger("atlas.live")
HOT_WINDOW_S = 600       # a tile stays hot for 10 minutes after its last viewer
MIN_INTERVAL_S = 60      # TomTom flow refreshes about once a minute
BUDGET_SHARE = 0.6       # the hot poller may spend this share of what is left of the daily budget


class Broadcaster:
    """Fan-out of memory notifications to SSE subscribers (one asyncio queue per open stream)."""

    def __init__(self) -> None:
        self.queues: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.sent = 0

    def attach(self, history: Any) -> None:
        history.subscribe(self.on_event)

    def on_event(self, kind: str, payload: dict[str, Any]) -> None:
        # History notifies from whichever thread recorded; hand the event to the loop safely.
        slim = {k: v for k, v in payload.items() if k != "segments"}
        if kind == "flow":
            slim["count"] = len(payload.get("segments") or [])
        msg = {"kind": kind, "t": time.time(), **slim}
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self._push, msg)

    def _push(self, msg: dict[str, Any]) -> None:
        for q in list(self.queues):
            if q.qsize() < 200:
                q.put_nowait(msg)
        self.sent += 1

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.queues.discard(q)


def sse(msg: dict[str, Any]) -> str:
    return f"event: {msg.get('kind', 'message')}\ndata: {json.dumps(msg)}\n\n"


class HotTiles:
    """Flow tiles with a recent viewer, re-read by the server on a budget-aware interval."""

    def __init__(self) -> None:
        self.seen: dict[str, float] = {}
        self.bboxes: dict[str, float] = {}
        self.last_cycle: dict[str, Any] = {}

    def touch(self, key: str, now: float | None = None) -> None:
        self.seen[key] = time.time() if now is None else now

    def touch_bbox(self, bbox: str, now: float | None = None) -> None:
        self.bboxes[bbox] = time.time() if now is None else now

    def hot(self, now: float | None = None) -> list[str]:
        now = time.time() if now is None else now
        self.seen = {k: t for k, t in self.seen.items() if now - t <= HOT_WINDOW_S}
        return sorted(self.seen)

    def hot_bboxes(self, now: float | None = None) -> list[str]:
        now = time.time() if now is None else now
        self.bboxes = {k: t for k, t in self.bboxes.items() if now - t <= HOT_WINDOW_S}
        return sorted(self.bboxes)[:4]

    @staticmethod
    def interval(hot_count: int, budget_left: int) -> float:
        """Seconds between re-reads so that the hot set spends at most BUDGET_SHARE of what is left today."""
        if hot_count == 0:
            return MIN_INTERVAL_S
        per_day = max(50.0, BUDGET_SHARE * budget_left)
        return max(MIN_INTERVAL_S, hot_count * 86400.0 / per_day)


def register(app: FastAPI, history: Any, tomtom: Any, osm: Any, fixtures_mode: bool) -> tuple[Broadcaster, HotTiles]:
    bc = Broadcaster()
    bc.attach(history)
    hot = HotTiles()
    app.state.broadcast = bc
    app.state.hot = hot
    warming: set[str] = set()

    @app.get("/api/stream")
    async def stream(request: Request):
        """Server-sent events: flow (tile refreshed), incidents, camera, zone, as they are recorded."""
        bc.loop = asyncio.get_running_loop()
        q = bc.subscribe()

        async def gen():
            try:
                yield sse({"kind": "hello", "t": time.time(), "hot": len(hot.hot()), "subscribers": len(bc.queues)})
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(q.get(), timeout=20)
                        yield sse(msg)
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
            finally:
                bc.unsubscribe(q)
        return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/live/status")
    async def live_status():
        return {"hotTiles": hot.hot(), "hotBboxes": hot.hot_bboxes(), "subscribers": len(bc.queues), "eventsSent": bc.sent, "lastCycle": hot.last_cycle,
                "intervalS": HotTiles.interval(len(hot.hot()), max(0, getattr(tomtom, "daily_budget", 0) - tomtom.calls_today()) if hasattr(tomtom, "calls_today") else 0)}

    @app.get("/api/warm")
    async def warm(lng: float = Query(..., ge=-180, le=180), lat: float = Query(..., ge=-90, le=90)):
        """Warm the streets around a point in the background (a state just chosen, a view about to be visited)."""
        key = f"{round(lng, 2)},{round(lat, 2)}"
        if fixtures_mode:
            return {"status": "skipped", "reason": "fixtures"}
        if key in warming:
            return {"status": "warming", "key": key}
        warming.add(key)

        async def run():
            try:
                await osm.warm(lng, lat, 1)
            except Exception as e:
                log.warning("warm %s: %s", key, e)
            finally:
                warming.discard(key)
        asyncio.create_task(run())
        return {"status": "started", "key": key}

    async def hot_poller():
        """Re-read every hot flow tile and incident box on the budget-aware interval; the stream carries the result."""
        await asyncio.sleep(5)
        while True:
            try:
                keys = hot.hot()
                budget_left = max(0, tomtom.daily_budget - tomtom.calls_today()) if hasattr(tomtom, "calls_today") else 0
                interval = HotTiles.interval(len(keys), budget_left)
                done = 0
                for k in keys:
                    z, x, y = (int(v) for v in k.split("/"))
                    try:
                        await tomtom.flow_tile(z, x, y, max_age=interval - 5)
                        done += 1
                    except Exception as e:
                        log.warning("hot flow %s: %s", k, e)
                        break
                for b in hot.hot_bboxes():
                    try:
                        await tomtom.incidents(b, max_age=interval - 5)
                    except Exception as e:
                        log.warning("hot incidents %s: %s", b, e)
                        break
                hot.last_cycle = {"t": time.time(), "tiles": done, "intervalS": interval, "budgetLeft": budget_left}
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("hot poller: %s", e)
                await asyncio.sleep(30)

    app.state.hot_poller = hot_poller
    return bc, hot
