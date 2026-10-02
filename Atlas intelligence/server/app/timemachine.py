"""
The time machine: PAST is what the city actually read at that instant (its memory), FUTURE is a
prediction from what the same roads usually read at that hour, labelled as such with a confidence.
Nothing here is simulated: a road with no memory is left out and the response says how many are known.
"""
from __future__ import annotations

import math
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query

from .memory import History

MAX_PAST_S = 28 * 86400
MAX_AHEAD_S = 12 * 3600
MAX_BBOX_DEG2 = 0.25
# Readings are kept at a segment's midpoint; a long TomTom segment can cross the screen with its midpoint outside it.
FLOW_PAD_DEG = 0.03


def _bbox(bbox: str) -> tuple[float, float, float, float]:
    try:
        w, s, e, n = (float(v) for v in bbox.split(","))
    except ValueError as exc:
        raise HTTPException(400, "bbox must be west,south,east,north") from exc
    if not (w < e and s < n) or (e - w) * (n - s) > MAX_BBOX_DEG2:
        raise HTTPException(400, "bbox is empty or too large")
    return w, s, e, n


def _padded(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    w, s, e, n = bbox
    return (w - FLOW_PAD_DEG, s - FLOW_PAD_DEG, e + FLOW_PAD_DEG, n + FLOW_PAD_DEG)


PAST_WINDOW_S = 3 * 3600


def history_at(history: History, bbox: tuple[float, float, float, float], at: float) -> dict[str, Any]:
    flow = history.flow_at_bbox(*_padded(bbox), at=at, window_s=PAST_WINDOW_S)
    offsets = [abs(r["offsetS"]) for r in flow]
    typical_offset = int(sorted(offsets)[len(offsets) // 2]) if offsets else None
    incidents = history.incidents_at_bbox(*bbox, at=at)
    cov = history.coverage_bbox(*bbox)
    return {
        "at": at, "kind": "recorded",
        "flow": {"segments": flow, "count": len(flow), "typicalOffsetS": typical_offset},
        "incidents": incidents,
        "coverage": cov,
        "evidence": {"classification": "observed", "source": "atlas-memory", "timestamp": at, "confidence": (1.0 if (typical_offset or 0) <= 900 else 0.7) if flow else 0.0,
                     "model": "the readings the city kept nearest that time (within 3 hours); nothing interpolated"},
    }


def forecast_at(history: History, bbox: tuple[float, float, float, float], at: float, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    ahead = max(0.0, at - now)
    pb = _padded(bbox)
    usual_then = history.usual_in_bbox(*pb, at=at, min_samples=1)
    usual_now = history.usual_in_bbox(*pb, at=now, min_samples=1) if usual_then else {}
    now_levels = {r["segment"]: r for r in history.flow_in_bbox(*pb, within_s=900, now=now)}
    decay = math.exp(-ahead / 2700.0)  # what is unusual right now fades over about 45 minutes
    segments = []
    # no history for a road yet: the latest reading carried forward is the only honest guess, and it says so
    for seg, nl in now_levels.items():
        if seg not in usual_then:
            usual_then[seg] = {"usual": nl["level"], "samples": 0, "basis": "latest reading carried forward; no history for this hour yet"}
    for seg, u in usual_then.items():
        pred = u["usual"]
        anomaly = 0.0
        nl = now_levels.get(seg); un = usual_now.get(seg)
        if nl and un and un["usual"] is not None:
            anomaly = (nl["level"] - un["usual"]) * decay
            pred = max(0.0, min(1.0, pred + anomaly))
        conf = 0.2 if u["samples"] == 0 else min(0.8, 0.3 + 0.05 * u["samples"]) * (1.0 if u["basis"].startswith("same weekday") else 0.8 if u["basis"].startswith("same hour, any") else 0.6)
        segments.append({"segment": seg, "level": round(pred, 3), "usual": round(u["usual"], 3), "anomalyNow": round(anomaly, 3), "samples": u["samples"], "basis": u["basis"], "confidence": round(conf, 2),
                         "lng": nl["lng"] if nl else None, "lat": nl["lat"] if nl else None})
    cov = history.coverage_bbox(*bbox)
    mean_conf = round(sum(s["confidence"] for s in segments) / len(segments), 2) if segments else 0.0
    return {
        "at": at, "kind": "predicted", "aheadS": ahead,
        "flow": {"segments": segments, "count": len(segments), "known": len(segments), "roadsRemembered": cov["segments"]},
        "incidents": [],
        "coverage": cov,
        "evidence": {"classification": "predicted", "source": "atlas-memory", "timestamp": now, "confidence": mean_conf,
                     "model": "median of what each road read at this weekday and hour over 28 days, plus what is unusual right now fading over 45 min; roads without history carry their latest reading forward at low confidence; no incidents are predicted"},
    }


def register(app: FastAPI, history: History) -> None:
    @app.get("/api/history/at")
    def history_at_route(bbox: str = Query(..., max_length=80), at: float = Query(..., description="epoch seconds")) -> dict[str, Any]:
        now = time.time()
        if at > now + 60:
            raise HTTPException(400, "that time has not happened yet; ask /api/forecast/at")
        if at < now - MAX_PAST_S:
            raise HTTPException(400, "the memory keeps 28 days")
        return history_at(history, _bbox(bbox), at)

    @app.get("/api/forecast/at")
    def forecast_at_route(bbox: str = Query(..., max_length=80), at: float = Query(..., description="epoch seconds")) -> dict[str, Any]:
        now = time.time()
        if at > now + MAX_AHEAD_S:
            raise HTTPException(400, "predictions reach 12 hours ahead")
        return forecast_at(history, _bbox(bbox), max(at, now))
