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
    return {**r, "ageMin": int(max(0, now - r["ts"]) // 60), "evidence": {"classification": "observed", "source": "a person using City Atlas · not verified", "timestamp": int(r["ts"] * 1000), "confidence": 0.5}}


def register(app: FastAPI, history: History) -> None:
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
    def list_reports(bbox: str = Query(..., max_length=80), since: float = Query(KEEP_S, ge=60, le=KEEP_S)) -> dict[str, Any]:
        try:
            w, s, e, n = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(400, "bbox must be west,south,east,north") from exc
        if not (w < e and s < n) or (e - w) * (n - s) > MAX_BBOX_DEG2:
            raise HTTPException(400, "bbox is empty or too large")
        now = time.time()
        items = [shape(r, now) for r in history.reports_in_bbox(w, s, e, n, since_s=since, now=now)]
        return {"items": items, "count": len(items), "keptForS": KEEP_S, "note": "Reports come from people using City Atlas and are not verified. In an emergency call 112.", "computedAt": int(now * 1000)}
