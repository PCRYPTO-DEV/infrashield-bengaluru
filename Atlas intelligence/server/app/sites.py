"""
City Atlas Pro: the site finder. Ranks the H3 cells on screen for a purpose, from the same real
cell state the place card uses. A weight below zero means "the further the better" (a gap in
supply, e.g. a new pharmacy where none is near). Dimensions with no data are left out of the
score and listed as gaps, never guessed.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query

from .access import pro_only

PURPOSES: dict[str, dict[str, float]] = {
    # footfall and reach matter; a quiet, green, walkable street helps
    "cafe": {"shopping": 1.0, "access_transport": 1.0, "walkability": 1.0, "built": 0.75, "green": 0.5, "safety": 0.5, "noise": 0.25, "traffic": 0.25},
    # demand (people, reach) where the nearest pharmacy is far
    "pharmacy": {"access_pharmacy": -1.5, "built": 1.0, "access_transport": 0.75, "walkability": 0.5, "access_health": 0.5, "safety": 0.25},
    "clinic": {"access_health": -1.5, "built": 1.0, "access_transport": 1.0, "walkability": 0.5, "air": 0.25, "safety": 0.5},
    "school": {"access_school": -0.75, "built": 0.75, "green": 1.0, "air": 1.0, "safety": 1.0, "traffic": 0.5, "walkability": 0.75, "noise": 0.5},
    "shop": {"shopping": 1.0, "access_transport": 1.0, "walkability": 0.75, "built": 1.0, "connectivity": 0.5, "safety": 0.25},
    "office": {"access_transport": 1.5, "connectivity": 1.0, "built": 0.75, "air": 0.5, "safety": 0.5, "shopping": 0.5, "traffic": 0.5},
    "logistics": {"connectivity": 1.5, "traffic": 1.0, "built": -0.5, "noise": -0.25, "walkability": -0.25, "access_fire": 0.25},
    "housing": {"air": 1.0, "green": 1.0, "safety": 1.0, "noise": 0.75, "access_school": 0.75, "access_health": 0.75, "access_transport": 0.75, "walkability": 0.5, "traffic": 0.5, "rain": 0.25},
}
MAX_CELLS = 36
MAX_BBOX_DEG2 = 0.02


def score_cell(state: dict[str, Any], weights: dict[str, float]) -> dict[str, Any]:
    """Weighted mean of the dimensions that have data; negative weights invert the score (a gap is good)."""
    by_key = {d["key"]: d for d in state.get("dimensions", [])}
    num = den = cnum = 0.0
    why: list[dict[str, Any]] = []
    gaps: list[str] = []
    for key, w in weights.items():
        d = by_key.get(key)
        if d is None or d.get("score") is None:
            gaps.append(key)
            continue
        s = 100.0 - float(d["score"]) if w < 0 else float(d["score"])
        aw = abs(w)
        num += aw * s; den += aw; cnum += aw * float(d.get("confidence") or 0.0)
        why.append({"key": key, "score": round(s, 1), "weight": aw, "inverted": w < 0, "class": d.get("class"), "why": (d.get("why") or [])[:1]})
    why.sort(key=lambda r: r["weight"] * r["score"], reverse=True)
    score = round(num / den, 1) if den else None
    return {"score": score, "confidence": round(cnum / den, 2) if den else None, "coverage": round(den / sum(abs(w) for w in weights.values()), 2), "why": why[:4], "gaps": gaps}


async def find_sites(cells: Any, bbox: tuple[float, float, float, float], purpose: str, limit: int, now: float | None = None) -> dict[str, Any]:
    import h3

    now = time.time() if now is None else now
    weights = PURPOSES[purpose]
    w, s, e, n = bbox
    poly = h3.LatLngPoly([(s, w), (s, e), (n, e), (n, w)])
    ids = sorted(h3.polygon_to_cells(poly, 9))
    step = max(1, len(ids) // MAX_CELLS)
    ids = ids[::step][:MAX_CELLS]
    centres = [h3.cell_to_latlng(c) for c in ids]
    states = await asyncio.gather(*(cells.state(lng, lat, 9, cached_only=True, now=now) for lat, lng in centres), return_exceptions=True)
    out = []
    for cid, st in zip(ids, states):
        if isinstance(st, Exception):
            continue
        sc = score_cell(st, weights)
        if sc["score"] is None:
            continue
        out.append({"cell": cid, "centre": st["centre"], "boundary": st["boundary"], "atlasScore": st.get("score"), **sc})
    out.sort(key=lambda r: (r["score"], r["coverage"]), reverse=True)
    return {
        "purpose": purpose, "weights": weights, "cellsChecked": len(ids), "cellsScored": len(out), "candidates": out[:limit], "computedAt": int(now * 1000),
        "evidence": {"classification": "derived", "source": "atlas-cells", "timestamp": int(now * 1000), "confidence": round(sum(r["confidence"] or 0 for r in out[:limit]) / len(out[:limit]), 2) if out else 0.0,
                     "model": "weighted mean of the place-card dimensions that have data; a negative weight rewards a gap in supply; cells with no data are not ranked"},
    }


def register(app: FastAPI, cells: Any) -> None:
    @app.get("/api/sites", dependencies=[Depends(pro_only)])
    async def sites(bbox: str = Query(..., max_length=80), purpose: str = Query("cafe", max_length=20), limit: int = Query(6, ge=1, le=12)) -> dict[str, Any]:
        if purpose not in PURPOSES:
            raise HTTPException(400, f"purpose must be one of {', '.join(PURPOSES)}")
        try:
            w, s, e, n = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(400, "bbox must be west,south,east,north") from exc
        if not (w < e and s < n) or (e - w) * (n - s) > MAX_BBOX_DEG2:
            raise HTTPException(400, "zoom in: the site finder works on a view of about 10 km across")
        return await find_sites(cells, (w, s, e, n), purpose, limit)
