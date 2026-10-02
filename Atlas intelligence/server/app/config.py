"""Settings from environment variables. Nothing here is secret-bearing in code."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SERVER_DIR = Path(__file__).resolve().parent.parent

# Names people commonly use for the Anthropic key; the first that is set wins.
ANTHROPIC_KEY_NAMES = ("ANTHROPIC_API_KEY", "ANTHROPIC_KEY", "CLAUDE_API_KEY", "ANTHROPIC_APIKEY")


def _anthropic_key() -> str:
    """The key from the expected variable, else from a near-miss name (case, spaces or the usual variants)."""
    for name in ANTHROPIC_KEY_NAMES:
        v = os.getenv(name, "").strip().strip('"').strip("'")
        if v:
            return v
    for name, v in os.environ.items():
        if name.strip().upper().replace("-", "_") in ANTHROPIC_KEY_NAMES and v.strip():
            return v.strip().strip('"').strip("'")
    return ""


def anthropic_env_report() -> dict:
    """What the server can see about the key, without ever revealing it: matching variable names, the key's shape, the deployed commit."""
    names = sorted(n for n in os.environ if "ANTHROPIC" in n.upper() or "CLAUDE" in n.upper())
    key = _anthropic_key()
    return {
        "variablesSeen": names,
        "expectedName": "ANTHROPIC_API_KEY",
        "keyFound": bool(key),
        "keyLooksRight": key.startswith("sk-ant-") if key else None,
        "keyLength": len(key) if key else 0,
        "deployedCommit": (os.getenv("RENDER_GIT_COMMIT") or "")[:7] or None,
        "service": os.getenv("RENDER_SERVICE_NAME") or None,
    }
WEB_DIST = SERVER_DIR.parent / "web" / "dist"


@dataclass
class Settings:
    tomtom_api_key: str = field(default_factory=lambda: os.getenv("TOMTOM_API_KEY", ""))
    anthropic_api_key: str = field(default_factory=_anthropic_key)
    region: str = field(default_factory=lambda: os.getenv("ATLAS_REGION", "india"))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("ATLAS_DATA_DIR") or (SERVER_DIR / "data")))
    fixtures: Path | None = field(default_factory=lambda: Path(os.environ["ATLAS_FIXTURES"]) if os.getenv("ATLAS_FIXTURES") else None)
    tomtom_daily_budget: int = field(default_factory=lambda: int(os.getenv("TOMTOM_DAILY_BUDGET", "2000")))
    overpass_url: str = field(default_factory=lambda: os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter"))
    twilio_account_sid: str = field(default_factory=lambda: os.getenv("TWILIO_ACCOUNT_SID", ""))
    twilio_auth_token: str = field(default_factory=lambda: os.getenv("TWILIO_AUTH_TOKEN", ""))
    twilio_from_sms: str = field(default_factory=lambda: os.getenv("TWILIO_FROM_SMS", ""))
    twilio_from_whatsapp: str = field(default_factory=lambda: os.getenv("TWILIO_FROM_WHATSAPP", ""))
    # Baseline recorder: flow tiles (z/x/y, comma separated) polled every N minutes so the memory grows even with nobody watching
    baseline_tiles: str = field(default_factory=lambda: os.getenv("ATLAS_BASELINE_TILES", "12/2926/1707"))
    baseline_minutes: int = field(default_factory=lambda: int(os.getenv("ATLAS_BASELINE_MINUTES", "10")))
    # How many z14 blocks around the region origin to pre-fetch at startup (1 = a 3x3 ring, 144 street tiles). 0 disables.
    warm_radius: int = field(default_factory=lambda: int(os.getenv("ATLAS_WARM_RADIUS", "1")))
    # Pre-made OpenStreetMap vector tiles (OpenMapTiles schema). A TileJSON URL or a {z}/{x}/{y} template. "" disables.
    osm_tiles_url: str = field(default_factory=lambda: os.getenv("OSM_TILES_URL", "https://tiles.openfreemap.org/planet"))
    # The official OpenStreetMap API: a different host from the Overpass mirrors, used when none of them answers.
    osm_api_url: str = field(default_factory=lambda: os.getenv("OSM_API_URL", "https://api.openstreetmap.org/api/0.6/map.json"))
    # Many hosts publish IPv6 addresses that containers cannot route; IPv4 only avoids "all connection attempts failed".
    ipv4_only: bool = field(default_factory=lambda: os.getenv("ATLAS_IPV4_ONLY", "1") != "0")
    tomtom_base: str = "https://api.tomtom.com"
    open_meteo_base: str = "https://api.open-meteo.com"
    open_meteo_air_base: str = "https://air-quality-api.open-meteo.com"

    @property
    def db_path(self) -> Path:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir / "atlas.db"


settings = Settings()
