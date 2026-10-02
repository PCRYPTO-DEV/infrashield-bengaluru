"""
Just reported: crimes and unsafe moments that people report through City Atlas. Each report is
kept for a day and shown to everyone looking at that place, marked as a person's report that the
app has not verified. The app never invents a report; it only passes on what someone said, when,
and where. In an emergency people are told to call 112.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .memory import History

KINDS = ("theft", "snatching", "harassment", "assault", "vandalism", "suspicious", "accident", "other")
KEEP_S = 86400
MAX_PER_DAY = 10
MAX_BBOX_DEG2 = 0.25


class ReportIn(BaseModel):
    kind: str = Field(..., max_length=20)
    description: str = Field("", max_length=200)
    lng: float = Field(..., ge=-180, le=180)
    lat: float = Field(..., ge=-90, le=90)


def _reporter(request: Request) -> str:
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    return hashlib.blake2b(ip.encode(), digest_size=8).hexdigest()


def shape(r: dict[str, Any], now: float) -> dict[str, Any]:
    news = r.get("source") == "news"
    src = f"{r.get('publisher') or 'news'} · place approximate from the headline" if news else "a person using City Atlas · not verified"
    return {**r, "source": r.get("source") or "person", "ageMin": int(max(0, now - r["ts"]) // 60), "evidence": {"classification": "observed", "source": src, "timestamp": int(r["ts"] * 1000), "confidence": 0.6 if news else 0.5}}


def register(app: FastAPI, history: History, news: Any = None) -> None:
    @app.post("/api/reports")
    def create(body: ReportIn, request: Request) -> dict[str, Any]:
        if body.kind not in KINDS:
            raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
        who = _reporter(request)
        if history.reports_today_by(who) >= MAX_PER_DAY:
            raise HTTPException(429, "that is enough reports from one place for one day")
        now = time.time()
        r = history.record_report(body.kind, body.description.strip(), body.lng, body.lat, who, now)
        return shape(r, now)

    @app.get("/api/reports")
    async def list_reports(bbox: str = Query(..., max_length=80), since: float = Query(KEEP_S, ge=60, le=KEEP_S)) -> dict[str, Any]:
        try:
            w, s, e, n = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(400, "bbox must be west,south,east,north") from exc
        if not (w < e and s < n) or (e - w) * (n - s) > MAX_BBOX_DEG2:
            raise HTTPException(400, "bbox is empty or too large")
        now = time.time()
        news_note = None
        if news is not None:
            try:
                st = await news.refresh((w + e) / 2, (s + n) / 2)
                if st and st.get("city"):
                    news_note = {"city": st["city"], "unplaced": news.unplaced.get(st["city"], 0), "error": st.get("error")}
            except Exception as exc:  # the feed is optional
                news_note = {"error": str(exc)}
        items = [shape(r, now) for r in history.reports_in_bbox(w, s, e, n, since_s=since, now=now)]
        return {"items": items, "count": len(items), "keptForS": KEEP_S, "news": news_note,
                "note": "Reports come from people using City Atlas (not verified) and from crime headlines in the news for this city (place approximate). In an emergency call 112.", "computedAt": int(now * 1000)}
