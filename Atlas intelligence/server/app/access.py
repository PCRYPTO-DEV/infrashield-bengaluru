"""
Plus and Pro, checked on the server. The passwords live in the server's environment
(ATLAS_PLUS_PASSWORD, ATLAS_PRO_PASSWORD), never in the web app. A correct password returns a
signed token (HMAC-SHA256 with ATLAS_SECRET) that the app sends with every Pro request as
X-Atlas-Token. Without a valid Pro token the Pro endpoints answer 403.

Until the variables are set the old passwords still work, so nothing breaks on deploy, and the
status page says plainly that the defaults are in use. Without ATLAS_SECRET a random secret is made
at start-up, so people unlock again after a restart.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

RANK = {"free": 0, "plus": 1, "pro": 2}
TOKEN_DAYS = 30
MAX_TRIES = 10          # wrong passwords per address per window
TRY_WINDOW_S = 600


class Access:
    def __init__(self, cache: Any) -> None:
        self.cache = cache
        self.plus = os.getenv("ATLAS_PLUS_PASSWORD", "").strip()
        self.pro = os.getenv("ATLAS_PRO_PASSWORD", "").strip()
        self.defaults = {"plus": not self.plus, "pro": not self.pro}
        self.plus = self.plus or "atbose"
        self.pro = self.pro or "atbose-pro"
        env_secret = os.getenv("ATLAS_SECRET", "").strip()
        self.secret_is_set = bool(env_secret)
        self.secret = (env_secret or secrets.token_hex(32)).encode()

    def tier_for(self, password: str) -> str | None:
        p = password.strip()
        if hmac.compare_digest(p, self.pro):
            return "pro"
        if hmac.compare_digest(p, self.plus):
            return "plus"
        return None

    def sign(self, tier: str, now: float | None = None) -> str:
        now = time.time() if now is None else now
        body = base64.urlsafe_b64encode(json.dumps({"t": tier, "exp": int(now + TOKEN_DAYS * 86400)}, separators=(",", ":")).encode()).decode().rstrip("=")
        sig = base64.urlsafe_b64encode(hmac.new(self.secret, body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        return f"{body}.{sig}"

    def verify(self, token: str | None, now: float | None = None) -> str:
        """The tier a token carries, or 'free' when it is missing, forged or expired."""
        if not token or "." not in token:
            return "free"
        body, sig = token.rsplit(".", 1)
        good = base64.urlsafe_b64encode(hmac.new(self.secret, body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        if not hmac.compare_digest(sig, good):
            return "free"
        try:
            data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        except ValueError:
            return "free"
        now = time.time() if now is None else now
        if data.get("exp", 0) < now or data.get("t") not in RANK:
            return "free"
        return data["t"]

    def require(self, need: str, token: str | None) -> None:
        if RANK[self.verify(token)] < RANK[need]:
            raise HTTPException(403, f"City Atlas {need.capitalize()} is needed for this. Unlock it with the {need.capitalize()} password.")

    def report(self) -> dict[str, Any]:
        return {"plusPasswordSet": not self.defaults["plus"], "proPasswordSet": not self.defaults["pro"], "secretSet": self.secret_is_set}


class UnlockIn(BaseModel):
    password: str = Field(..., max_length=200)


def _who(request: Request) -> str:
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    return hashlib.blake2b(ip.encode(), digest_size=8).hexdigest()


def register(app: FastAPI, access: Access) -> None:
    @app.post("/api/unlock")
    def unlock(body: UnlockIn, request: Request) -> dict[str, Any]:
        """Swap a password for a signed token. Ten wrong tries per address in ten minutes, then a pause."""
        key = f"unlock:tries:{_who(request)}:{int(time.time() // TRY_WINDOW_S)}"
        if access.cache.count(key) >= MAX_TRIES:
            raise HTTPException(429, "Too many wrong passwords. Wait ten minutes and try again.")
        tier = access.tier_for(body.password)
        if not tier:
            access.cache.increment(key)
            raise HTTPException(401, "That password is not right.")
        return {"tier": tier, "token": access.sign(tier), "days": TOKEN_DAYS}

    @app.get("/api/unlock/check")
    def check(x_atlas_token: str | None = Header(None)) -> dict[str, Any]:
        return {"tier": access.verify(x_atlas_token)}


def pro_only(request: Request, x_atlas_token: str | None = Header(None)) -> None:
    """Route dependency: a valid Pro token, or 403."""
    request.app.state.access.require("pro", x_atlas_token)
