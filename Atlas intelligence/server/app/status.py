"""
Status: is every source working on this server, right now? One row per source, green, red or grey
(not set up / not checked), with what it means and how to fix it. Live probes are small, run in
parallel with short timeouts, and are cached for five minutes so the page never hammers anyone.
"""
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI

from .config import anthropic_env_report, settings
from .news import feed_url
from .osm import http_client

PROBE_TTL_S = 300


def row(key: str, ok: bool | None, detail: str, fix: str | None = None) -> dict[str, Any]:
    return {"key": key, "ok": ok, "detail": detail, "fix": fix if ok is not True else None}


def storage_row(data_dir: Path, history: Any) -> dict[str, Any]:
    persistent = os.path.ismount(str(data_dir)) or any(os.path.ismount(str(p)) for p in data_dir.parents if str(p) not in ("/",))
    readings = history.count("flow_readings")
    with history._lock:
        first = history._conn.execute("SELECT MIN(ts) FROM flow_readings").fetchone()[0]
    since = time.strftime("%Y-%m-%d", time.gmtime(first)) if first else "—"
    detail = f"{readings} traffic readings kept since {since}, in {data_dir}"
    if persistent:
        return row("storage", True, detail + " (a persistent disk).")
    return row("storage", False, detail + ". This folder is not a separate disk, so the memory is wiped on every deploy or restart.",
               "Render → the service → Disks → add a 1–2 GB disk mounted at /var/data, and set ATLAS_DATA_DIR=/var/data.")


async def probe(url: str, method: str = "GET", data: dict[str, str] | None = None, timeout: float = 10.0) -> tuple[bool, str]:
    t0 = time.monotonic()
    try:
        async with http_client(httpx.Timeout(timeout, connect=6.0)) as c:
            r = await (c.post(url, data=data) if method == "POST" else c.get(url))
        ms = int((time.monotonic() - t0) * 1000)
        return (r.status_code < 400, f"HTTP {r.status_code} in {ms} ms")
    except Exception as e:
        return (False, f"{type(e).__name__}: {str(e)[:120]}")


class Status:
    def __init__(self, app: FastAPI, history: Any, fixtures: Any) -> None:
        self.app, self.history, self.fixtures = app, history, fixtures
        self._probes: dict[str, Any] | None = None
        self._at = 0.0

    async def probes(self) -> dict[str, tuple[bool, str]]:
        if self._probes is not None and time.time() - self._at < PROBE_TTL_S:
            return self._probes
        overpass = settings.overpass_url.split(",")[0].strip()
        jobs = {
            "overpass": probe(overpass, "POST", {"data": '[out:json][timeout:8];node["amenity"="cafe"](around:300,28.6315,77.2167);out count;'}),
            "news": probe(feed_url("Delhi")),
            "weather": probe(f"{settings.open_meteo_base}/v1/forecast?latitude=28.63&longitude=77.22&current=temperature_2m"),
            "tiles": probe(settings.osm_tiles_url) if settings.osm_tiles_url else asyncio.sleep(0, (False, "not configured")),
        }
        res = await asyncio.gather(*jobs.values())
        self._probes, self._at = dict(zip(jobs.keys(), res)), time.time()
        return self._probes

    async def report(self) -> dict[str, Any]:
        st = self.app.state
        rows: list[dict[str, Any]] = []
        env = anthropic_env_report()
        rows.append(row("deploy", True if env["deployedCommit"] else None, f"Running commit {env['deployedCommit']}" if env["deployedCommit"] else "Commit unknown (not running on Render)."))
        rows.append(storage_row(settings.data_dir, self.history))
        tt = getattr(st, "tomtom", None)
        if settings.tomtom_api_key:
            used = tt.calls_today() if tt else 0
            rows.append(row("tomtom", used < settings.tomtom_daily_budget, f"Key set. {used} of {settings.tomtom_daily_budget} calls used today.",
                            "The daily budget is used up; live traffic resumes tomorrow, or raise TOMTOM_DAILY_BUDGET."))
        else:
            rows.append(row("tomtom", False, "No TOMTOM_API_KEY: no live traffic, incidents, search or routes.", "Render → Environment → add TOMTOM_API_KEY."))
        if env["keyFound"] and env["keyLooksRight"]:
            rows.append(row("writer", True, "Anthropic key set: Ask Atlas answers in natural sentences."))
        else:
            rows.append(row("writer", False, "No working ANTHROPIC_API_KEY: Ask Atlas answers with a list of facts instead of sentences.",
                            "Render → Environment → add ANTHROPIC_API_KEY (starts with sk-ant-)."))
        access = getattr(st, "access", None)
        if access:
            a = access.report()
            ok = a["plusPasswordSet"] and a["proPasswordSet"] and a["secretSet"]
            rows.append(row("access", ok, "Plus and Pro passwords and the token secret are set on the server." if ok else
                            "The old default passwords still work (they are in public history), or the token secret is not set.",
                            "Render → Environment → set ATLAS_PLUS_PASSWORD, ATLAS_PRO_PASSWORD and ATLAS_SECRET (any long random text)."))
        if self.fixtures is not None:
            for k in ("overpass", "news", "weather", "tiles"):
                rows.append(row(k, None, "Not checked: running on test data."))
        else:
            p = await self.probes()
            hints = {
                "overpass": ("OpenStreetMap places and history (gentrification, INVEST supply, track record)", "Allow outbound HTTPS to the Overpass servers, or set OVERPASS_URL to a mirror that answers."),
                "news": ("Google News (crime headlines, area buzz, distress)", "Allow outbound HTTPS to news.google.com."),
                "weather": ("Open-Meteo weather and air", "Allow outbound HTTPS to api.open-meteo.com."),
                "tiles": ("OpenStreetMap streets for the map", "Allow outbound HTTPS to tiles.openfreemap.org, or set OSM_TILES_URL."),
            }
            for k, (ok, det) in p.items():
                rows.append(row(k, ok, f"{hints[k][0]}: {det}.", hints[k][1]))
        tr = getattr(st, "trackrecord", None)
        if tr:
            g = tr.gentrification("gurugram", start=False)
            done = g.get("status") == "ok"
            rows.append(row("trackrecord", True if done else None, "Gurugram check done." if done else
                            ("Gurugram check running." if g.get("status") == "running" else "Not run yet: open the Track record once to start it.")))
        bad = sum(1 for r in rows if r["ok"] is False)
        return {"ok": bad == 0, "problems": bad, "rows": rows, "checkedAt": int(time.time() * 1000)}


def register(app: FastAPI, status: Status) -> None:
    @app.get("/api/status")
    async def get_status() -> dict[str, Any]:
        """Every source this server depends on: working, broken (with the fix), or not checked."""
        return await status.report()
