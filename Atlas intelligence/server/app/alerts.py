"""Alerts in plain words, sent where people are.

A rule watches one thing the city memory already records:

* ``road_slow``: a road's live level (current ÷ free-flow speed) stays below
  a limit for N minutes.
* ``count_above``: a camera counts more people or vehicles than a limit.
* ``zone_event``: a watched zone reports an event of a given kind.

Rules are evaluated every time a reading arrives. A fired alert is written
to the log and delivered through Twilio (WhatsApp or SMS) when configured;
otherwise it is kept in the app only, and the log says so. Messages are
short, in English or Hindi, and never invent a fact.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .config import settings
from .memory import History

log = logging.getLogger("atlas.alerts")

COOLDOWN_S = 15 * 60
Channel = Literal["app", "sms", "whatsapp"]
Language = Literal["en", "hi"]


class RoadSlowRule(BaseModel):
    kind: Literal["road_slow"]
    tile: str = Field(..., pattern=r"^\d{1,2}/\d+/\d+$")
    segment: str | None = Field(None, max_length=120)
    road: str = Field("this road", max_length=120)
    levelBelow: float = Field(0.5, ge=0.05, le=1.0)
    minutes: int = Field(10, ge=1, le=180)


class CountAboveRule(BaseModel):
    kind: Literal["count_above"]
    camera: str = Field(..., max_length=64)
    what: Literal["people", "vehicles", "all"] = "all"
    above: int = Field(..., ge=1, le=100000)


class ZoneEventRule(BaseModel):
    kind: Literal["zone_event"]
    zone: str = Field(..., max_length=120)
    events: list[str] = Field(default_factory=lambda: ["count", "dwell"])


Rule = RoadSlowRule | CountAboveRule | ZoneEventRule


class AlertIn(BaseModel):
    name: str = Field(..., max_length=80)
    channel: Channel = "app"
    to: str = Field("", max_length=32)
    language: Language = "en"
    rule: Rule


class Alert(AlertIn):
    id: str
    createdAt: int
    lastFiredAt: int | None = None
    enabled: bool = True


def message_for(alert: AlertIn, facts: dict[str, Any]) -> str:
    """Plain words, no new facts. Hindi keeps names as they are."""
    r = alert.rule
    hi = alert.language == "hi"
    if isinstance(r, RoadSlowRule):
        pct = round(facts.get("level", 0) * 100)
        return (f"{alert.name}: {r.road} बहुत धीमा है। गाड़ियाँ खुली सड़क की रफ़्तार के {pct}% पर चल रही हैं, पिछले {r.minutes} मिनट से। (TomTom से देखा गया)"
                if hi else f"{alert.name}: {r.road} is very slow. Traffic is moving at {pct}% of its free speed, and has been for {r.minutes} minutes. (seen by TomTom)")
    if isinstance(r, CountAboveRule):
        n = facts.get("count", 0)
        what = {"people": ("लोग", "people"), "vehicles": ("गाड़ियाँ", "vehicles"), "all": ("लोग और गाड़ियाँ", "people and vehicles")}[r.what]
        return (f"{alert.name}: कैमरा {r.camera} को अभी {n} {what[0]} दिख रहे हैं, सीमा {r.above} थी। (कैमरे से देखा गया)"
                if hi else f"{alert.name}: camera {r.camera} sees {n} {what[1]} right now, above your limit of {r.above}. (seen by the camera)")
    desc = facts.get("description", "")
    return (f"{alert.name}: इलाक़े \"{r.zone}\" में: {desc}" if hi else f"{alert.name}: in zone \"{r.zone}\": {desc}")


class Twilio:
    """Minimal Twilio Messages API client; configured from the environment."""

    def __init__(self, sid: str, token: str, from_sms: str, from_whatsapp: str):
        self.sid, self.token, self.from_sms, self.from_whatsapp = sid, token, from_sms, from_whatsapp

    @property
    def configured(self) -> bool:
        return bool(self.sid and self.token and (self.from_sms or self.from_whatsapp))

    def send(self, channel: Channel, to: str, body: str) -> str:
        if channel == "whatsapp":
            frm, dest = self.from_whatsapp, f"whatsapp:{to}" if not to.startswith("whatsapp:") else to
            if not frm.startswith("whatsapp:"):
                frm = f"whatsapp:{frm}"
        else:
            frm, dest = self.from_sms, to
        if not frm:
            raise RuntimeError(f"no Twilio sender configured for {channel}")
        r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json", auth=(self.sid, self.token), data={"From": frm, "To": dest, "Body": body}, timeout=20)
        r.raise_for_status()
        return str(r.json().get("sid", ""))


class AlertEngine:
    def __init__(self, path: Path | str, history: History, twilio: Twilio | None = None, sender: Any = None):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute("CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, body TEXT NOT NULL, created REAL NOT NULL, last_fired REAL, enabled INTEGER NOT NULL DEFAULT 1)")
        self._conn.execute("CREATE TABLE IF NOT EXISTS alert_log (ts REAL NOT NULL, alert_id TEXT NOT NULL, message TEXT NOT NULL, delivered TEXT NOT NULL, detail TEXT)")
        self._conn.commit()
        self.history = history
        self.twilio = twilio
        self.sender = sender  # test hook: (channel, to, body) -> str
        self._below_since: dict[str, float] = {}
        history.subscribe(self.on_reading)

    # ---- storage ----
    def list(self) -> list[Alert]:
        with self._lock:
            rows = self._conn.execute("SELECT id, body, created, last_fired, enabled FROM alerts ORDER BY created DESC").fetchall()
        out = []
        for id_, body, created, last, enabled in rows:
            d = json.loads(body)
            out.append(Alert(id=id_, createdAt=int(created * 1000), lastFiredAt=int(last * 1000) if last else None, enabled=bool(enabled), **d))
        return out

    def create(self, a: AlertIn) -> Alert:
        if a.channel != "app" and not a.to.startswith("+"):
            raise HTTPException(400, "phone number must start with + and the country code")
        id_ = uuid.uuid4().hex[:12]
        now = time.time()
        with self._lock:
            self._conn.execute("INSERT INTO alerts (id, body, created, enabled) VALUES (?,?,?,1)", (id_, a.model_dump_json(), now))
            self._conn.commit()
        return Alert(id=id_, createdAt=int(now * 1000), **a.model_dump())

    def delete(self, id_: str) -> bool:
        with self._lock:
            n = self._conn.execute("DELETE FROM alerts WHERE id = ?", (id_,)).rowcount
            self._conn.commit()
        return n > 0

    def log(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT ts, alert_id, message, delivered, detail FROM alert_log ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        return [{"t": int(ts * 1000), "alertId": a, "message": m, "delivered": d, "detail": x} for ts, a, m, d, x in rows]

    # ---- evaluation ----
    def on_reading(self, kind: str, payload: dict[str, Any]) -> None:
        now = payload.get("ts", time.time())
        for alert in self.list():
            if not alert.enabled:
                continue
            if alert.lastFiredAt and now - alert.lastFiredAt / 1000 < COOLDOWN_S:
                continue
            facts = self._check(alert, kind, payload, now)
            if facts is not None:
                self.fire(alert, facts, now)

    def _check(self, alert: Alert, kind: str, p: dict[str, Any], now: float) -> dict[str, Any] | None:
        r = alert.rule
        if isinstance(r, RoadSlowRule) and kind == "flow" and p.get("tile") == r.tile:
            levels = {row[2]: row[3] for row in p.get("segments", [])}
            if r.segment:
                lvl = levels.get(r.segment)
                if lvl is None:
                    return None
                worst = lvl
            else:
                major = [row[3] for row in p.get("segments", []) if (row[4] or "").lower().startswith("major")] or list(levels.values())
                if not major:
                    return None
                worst = min(major)
            key = alert.id
            if worst < r.levelBelow:
                since = self._below_since.setdefault(key, now)
                if now - since >= r.minutes * 60 - 1:
                    return {"level": worst}
            else:
                self._below_since.pop(key, None)
            return None
        if isinstance(r, CountAboveRule) and kind == "camera" and p.get("camera") == r.camera:
            n = p["people"] if r.what == "people" else p["vehicles"] if r.what == "vehicles" else p["people"] + p["vehicles"]
            return {"count": n} if n > r.above else None
        if isinstance(r, ZoneEventRule) and kind == "zone" and p.get("zone") == r.zone and p.get("kind") in r.events:
            return {"description": p.get("description", "")}
        return None

    def fire(self, alert: Alert, facts: dict[str, Any], now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        body = message_for(alert, facts)
        delivered, detail = "app", "shown in the app only"
        try:
            if alert.channel != "app":
                if self.sender:
                    detail = self.sender(alert.channel, alert.to, body)
                    delivered = alert.channel
                elif self.twilio and self.twilio.configured:
                    detail = self.twilio.send(alert.channel, alert.to, body)
                    delivered = alert.channel
                else:
                    detail = "no message service configured; shown in the app only"
        except Exception as e:  # delivery problems never lose the alert
            delivered, detail = "failed", str(e)[:200]
            log.warning("alert %s delivery failed: %s", alert.id, e)
        with self._lock:
            self._conn.execute("INSERT INTO alert_log VALUES (?,?,?,?,?)", (now, alert.id, body, delivered, detail))
            self._conn.execute("UPDATE alerts SET last_fired = ? WHERE id = ?", (now, alert.id))
            self._conn.commit()
        return {"message": body, "delivered": delivered, "detail": detail}


def twilio_from_env() -> Twilio | None:
    t = Twilio(settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_sms, settings.twilio_from_whatsapp)
    return t if t.configured else None


def register(app: FastAPI, engine: AlertEngine) -> None:
    app.state.alerts = engine

    @app.get("/api/alerts")
    def list_alerts() -> dict[str, Any]:
        return {"alerts": [a.model_dump() for a in engine.list()], "delivery": {"sms": bool(engine.twilio and engine.twilio.from_sms), "whatsapp": bool(engine.twilio and engine.twilio.from_whatsapp)}}

    @app.post("/api/alerts")
    def create_alert(a: AlertIn) -> dict[str, Any]:
        return engine.create(a).model_dump()

    @app.delete("/api/alerts/{alert_id}")
    def delete_alert(alert_id: str) -> dict[str, Any]:
        if not engine.delete(alert_id):
            raise HTTPException(404, "no such alert")
        return {"ok": True}

    @app.post("/api/alerts/{alert_id}/test")
    def test_alert(alert_id: str) -> dict[str, Any]:
        a = next((x for x in engine.list() if x.id == alert_id), None)
        if not a:
            raise HTTPException(404, "no such alert")
        facts = {"level": a.rule.levelBelow if isinstance(a.rule, RoadSlowRule) else 0, "count": a.rule.above + 1 if isinstance(a.rule, CountAboveRule) else 0, "description": "test message"}
        return engine.fire(a, facts)

    @app.get("/api/alerts/log")
    def alert_log(limit: int = 50) -> dict[str, Any]:
        return {"log": engine.log(min(200, max(1, limit)))}
