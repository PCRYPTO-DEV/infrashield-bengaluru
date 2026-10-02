"""Settings from environment variables. Nothing here is secret-bearing in code."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SERVER_DIR = Path(__file__).resolve().parent.parent
WEB_DIST = SERVER_DIR.parent / "web" / "dist"


@dataclass
class Settings:
    tomtom_api_key: str = field(default_factory=lambda: os.getenv("TOMTOM_API_KEY", ""))
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    region: str = field(default_factory=lambda: os.getenv("ATLAS_REGION", "ncr"))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("ATLAS_DATA_DIR") or (SERVER_DIR / "data")))
    fixtures: Path | None = field(default_factory=lambda: Path(os.environ["ATLAS_FIXTURES"]) if os.getenv("ATLAS_FIXTURES") else None)
    tomtom_daily_budget: int = field(default_factory=lambda: int(os.getenv("TOMTOM_DAILY_BUDGET", "2000")))
    overpass_url: str = field(default_factory=lambda: os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter"))
    tomtom_base: str = "https://api.tomtom.com"
    open_meteo_base: str = "https://api.open-meteo.com"

    @property
    def db_path(self) -> Path:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir / "atlas.db"


settings = Settings()
