"""Runtime settings, loaded from environment variables (and an optional .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, no interpolation. Never overrides real env."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # Claude
    model: str = "claude-opus-5-5"
    effort: str = "medium"  # low | medium | high | xhigh | max

    # Publisher: "x" (X API v2 via tweepy), "typefully", or "dryrun" (never hits the network)
    publisher: str = "dryrun"

    # X API v2 credentials (OAuth 1.0a user context, needed to post as the account)
    x_api_key: str | None = None
    x_api_secret: str | None = None
    x_access_token: str | None = None
    x_access_token_secret: str | None = None
    x_bearer_token: str | None = None

    # Typefully (optional alternative publisher)
    typefully_api_key: str | None = None
    typefully_social_set_id: str | None = None

    # The account being managed (shown to the model; the X keys decide what is actually posted as)
    handle: str = "globerasia"
    display_name: str = "globereader"

    # Behaviour
    auto_publish_posts: bool = False  # original posts may skip human approval. Replies never do.
    max_posts_per_run: int = 3
    timezone: str = "Asia/Kolkata"

    # Paths
    db_path: Path = field(default_factory=lambda: REPO_ROOT / "x_agent" / "x_agent.db")
    facts_path: Path = field(default_factory=lambda: REPO_ROOT / "x_agent" / "facts.md")
    voice_path: Path = field(default_factory=lambda: REPO_ROOT / "x_agent" / "voice.md")

    @classmethod
    def from_env(cls, dotenv: Path | None = REPO_ROOT / ".env") -> "Settings":
        if dotenv is not None:
            _load_dotenv(dotenv)
        env = os.environ
        s = cls(
            model=env.get("X_AGENT_MODEL", cls.model),
            effort=env.get("X_AGENT_EFFORT", cls.effort),
            publisher=env.get("X_AGENT_PUBLISHER", cls.publisher).lower(),
            x_api_key=env.get("X_API_KEY"),
            x_api_secret=env.get("X_API_SECRET"),
            x_access_token=env.get("X_ACCESS_TOKEN"),
            x_access_token_secret=env.get("X_ACCESS_TOKEN_SECRET"),
            x_bearer_token=env.get("X_BEARER_TOKEN"),
            typefully_api_key=env.get("TYPEFULLY_API_KEY"),
            typefully_social_set_id=env.get("TYPEFULLY_SOCIAL_SET_ID"),
            handle=env.get("X_AGENT_HANDLE", cls.handle).lstrip("@"),
            display_name=env.get("X_AGENT_DISPLAY_NAME", cls.display_name),
            auto_publish_posts=_bool(env.get("X_AGENT_AUTO_PUBLISH_POSTS"), False),
            max_posts_per_run=int(env.get("X_AGENT_MAX_POSTS_PER_RUN", "3")),
            timezone=env.get("X_AGENT_TIMEZONE", "Asia/Kolkata"),
        )
        if db := env.get("X_AGENT_DB_PATH"):
            s.db_path = Path(db)
        return s

    def validate_publisher(self) -> None:
        if self.publisher == "x":
            missing = [
                name
                for name, val in {
                    "X_API_KEY": self.x_api_key,
                    "X_API_SECRET": self.x_api_secret,
                    "X_ACCESS_TOKEN": self.x_access_token,
                    "X_ACCESS_TOKEN_SECRET": self.x_access_token_secret,
                }.items()
                if not val
            ]
            if missing:
                raise ValueError(f"X publisher selected but missing env: {', '.join(missing)}")
        elif self.publisher == "typefully":
            if not self.typefully_api_key:
                raise ValueError("Typefully publisher selected but TYPEFULLY_API_KEY is not set")
        elif self.publisher != "dryrun":
            raise ValueError(f"Unknown X_AGENT_PUBLISHER={self.publisher!r} (use x, typefully or dryrun)")
