"""Publishing back-ends: X API v2 (tweepy), Typefully, and a dry run.

Every back-end exposes the same small surface so the agent tools never care
which one is wired in.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from .config import Settings
from .store import Mention

log = logging.getLogger(__name__)

TWEET_MAX_CHARS = 280
URL_WEIGHT = 23  # X counts any URL as 23 characters


def tweet_length(text: str) -> int:
    """Approximate X's weighted length: every URL counts as 23 characters."""
    import re

    total = 0
    last = 0
    for m in re.finditer(r"https?://\S+", text):
        total += len(text[last : m.start()]) + URL_WEIGHT
        last = m.end()
    total += len(text[last:])
    return total


@dataclass
class PostMetrics:
    tweet_id: str
    text: str
    created_at: str | None
    likes: int = 0
    reposts: int = 0
    replies: int = 0
    impressions: int = 0
    quotes: int = 0


@dataclass
class PublishResult:
    published_id: str
    url: str | None = None


class Publisher(Protocol):
    name: str

    def whoami(self) -> str: ...
    def post(self, text: str, in_reply_to: str | None = None) -> PublishResult: ...
    def fetch_mentions(self, since_id: str | None = None, limit: int = 25) -> list[Mention]: ...
    def recent_metrics(self, limit: int = 20) -> list[PostMetrics]: ...


# --------------------------------------------------------------------------- dry run
@dataclass
class DryRunPublisher:
    """Logs instead of posting. Safe default; also used by the tests."""

    name: str = "dryrun"
    posted: list[dict] = field(default_factory=list)
    canned_mentions: list[Mention] = field(default_factory=list)
    canned_metrics: list[PostMetrics] = field(default_factory=list)
    _counter: int = 1000

    def whoami(self) -> str:
        return "@dryrun (nothing is sent to X)"

    def post(self, text: str, in_reply_to: str | None = None) -> PublishResult:
        self._counter += 1
        pid = f"dryrun-{self._counter}"
        self.posted.append({"id": pid, "text": text, "in_reply_to": in_reply_to})
        log.info("DRY RUN post %s%s: %s", pid, f" (reply to {in_reply_to})" if in_reply_to else "", text)
        return PublishResult(published_id=pid)

    def fetch_mentions(self, since_id: str | None = None, limit: int = 25) -> list[Mention]:
        out = self.canned_mentions
        if since_id:
            out = [m for m in out if int(m.tweet_id) > int(since_id)]
        return out[:limit]

    def recent_metrics(self, limit: int = 20) -> list[PostMetrics]:
        return self.canned_metrics[:limit]


# --------------------------------------------------------------------------- X API v2
class XPublisher:
    """X API v2 via tweepy. Requires OAuth 1.0a user-context keys with write access."""

    name = "x"

    def __init__(self, settings: Settings):
        import tweepy  # imported lazily so dry runs do not need it

        self._tweepy = tweepy
        self.client = tweepy.Client(
            bearer_token=settings.x_bearer_token,
            consumer_key=settings.x_api_key,
            consumer_secret=settings.x_api_secret,
            access_token=settings.x_access_token,
            access_token_secret=settings.x_access_token_secret,
            wait_on_rate_limit=True,
        )
        self._me = None

    def _me_data(self):
        if self._me is None:
            self._me = self.client.get_me(user_auth=True).data
        return self._me

    def whoami(self) -> str:
        me = self._me_data()
        return f"@{me.username} (id {me.id})"

    def post(self, text: str, in_reply_to: str | None = None) -> PublishResult:
        resp = self.client.create_tweet(text=text, in_reply_to_tweet_id=in_reply_to, user_auth=True)
        tweet_id = str(resp.data["id"])
        me = self._me_data()
        return PublishResult(published_id=tweet_id, url=f"https://x.com/{me.username}/status/{tweet_id}")

    def fetch_mentions(self, since_id: str | None = None, limit: int = 25) -> list[Mention]:
        me = self._me_data()
        resp = self.client.get_users_mentions(
            id=me.id,
            since_id=since_id,
            max_results=max(5, min(limit, 100)),
            tweet_fields=["created_at", "author_id", "conversation_id"],
            expansions=["author_id"],
            user_fields=["username"],
            user_auth=True,
        )
        if not resp.data:
            return []
        users = {u.id: u.username for u in (resp.includes or {}).get("users", [])}
        return [
            Mention(
                tweet_id=str(t.id),
                author=users.get(t.author_id),
                text=t.text,
                created_at=t.created_at.isoformat() if t.created_at else None,
            )
            for t in resp.data
        ]

    def recent_metrics(self, limit: int = 20) -> list[PostMetrics]:
        me = self._me_data()
        resp = self.client.get_users_tweets(
            id=me.id,
            max_results=max(5, min(limit, 100)),
            tweet_fields=["created_at", "public_metrics"],
            exclude=["retweets", "replies"],
            user_auth=True,
        )
        if not resp.data:
            return []
        out = []
        for t in resp.data:
            pm = t.public_metrics or {}
            out.append(
                PostMetrics(
                    tweet_id=str(t.id),
                    text=t.text,
                    created_at=t.created_at.isoformat() if t.created_at else None,
                    likes=pm.get("like_count", 0),
                    reposts=pm.get("retweet_count", 0),
                    replies=pm.get("reply_count", 0),
                    impressions=pm.get("impression_count", 0),
                    quotes=pm.get("quote_count", 0),
                )
            )
        return out


# --------------------------------------------------------------------------- Typefully
class TypefullyPublisher:
    """Queues posts through Typefully (https://typefully.com), which publishes to X.

    Typefully handles scheduling into the account's next free slot. It cannot
    read mentions or metrics for us, so those return empty lists.
    """

    name = "typefully"
    BASE = "https://api.typefully.com/v1"

    def __init__(self, settings: Settings):
        import httpx2 as httpx  # the anthropic SDK already depends on httpx2

        self._http = httpx.Client(
            base_url=self.BASE,
            headers={"X-API-KEY": f"Bearer {settings.typefully_api_key}", "Content-Type": "application/json"},
            timeout=30.0,
        )

    def whoami(self) -> str:
        return "Typefully queue"

    def post(self, text: str, in_reply_to: str | None = None) -> PublishResult:
        if in_reply_to:
            raise RuntimeError("Typefully cannot reply to a specific tweet; use the X publisher for replies")
        resp = self._http.post(
            "/drafts/",
            content=json.dumps({"content": text, "schedule-date": "next-free-slot", "threadify": False}),
        )
        resp.raise_for_status()
        data = resp.json()
        return PublishResult(published_id=f"typefully-{data.get('id')}", url=data.get("share_url"))

    def fetch_mentions(self, since_id: str | None = None, limit: int = 25) -> list[Mention]:
        return []

    def recent_metrics(self, limit: int = 20) -> list[PostMetrics]:
        return []


def build_publisher(settings: Settings) -> Publisher:
    settings.validate_publisher()
    if settings.publisher == "x":
        return XPublisher(settings)
    if settings.publisher == "typefully":
        return TypefullyPublisher(settings)
    return DryRunPublisher()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
