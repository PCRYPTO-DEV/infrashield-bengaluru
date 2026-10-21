"""SQLite-backed approval queue, mention log and activity log.

Statuses for a draft:
  pending   -> written by the agent, waiting for a human
  approved  -> a human (or the auto-publish rule for original posts) cleared it
  published -> sent to X; ``published_id`` holds the tweet id
  rejected  -> a human declined it
  failed    -> publishing raised; see ``error``
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS drafts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL CHECK (kind IN ('post', 'reply')),
    text          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    rationale     TEXT,
    in_reply_to   TEXT,
    reply_to_user TEXT,
    created_at    TEXT NOT NULL,
    decided_at    TEXT,
    published_at  TEXT,
    published_id  TEXT,
    error         TEXT
);
CREATE TABLE IF NOT EXISTS mentions (
    tweet_id   TEXT PRIMARY KEY,
    author     TEXT,
    text       TEXT NOT NULL,
    created_at TEXT,
    seen_at    TEXT NOT NULL,
    triage     TEXT,
    handled    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL,
    event   TEXT NOT NULL,
    detail  TEXT
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Draft:
    id: int
    kind: str
    text: str
    status: str
    rationale: str | None
    in_reply_to: str | None
    reply_to_user: str | None
    created_at: str
    published_id: str | None = None
    error: str | None = None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Draft":
        return cls(
            id=row["id"],
            kind=row["kind"],
            text=row["text"],
            status=row["status"],
            rationale=row["rationale"],
            in_reply_to=row["in_reply_to"],
            reply_to_user=row["reply_to_user"],
            created_at=row["created_at"],
            published_id=row["published_id"],
            error=row["error"],
        )


@dataclass
class Mention:
    tweet_id: str
    author: str | None
    text: str
    created_at: str | None
    triage: str | None = None
    handled: bool = False


class Store:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    # ---- drafts -----------------------------------------------------------
    def add_draft(
        self,
        kind: str,
        text: str,
        rationale: str | None = None,
        in_reply_to: str | None = None,
        reply_to_user: str | None = None,
        status: str = "pending",
    ) -> Draft:
        cur = self.conn.execute(
            "INSERT INTO drafts (kind, text, status, rationale, in_reply_to, reply_to_user, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (kind, text, status, rationale, in_reply_to, reply_to_user, _now()),
        )
        self.conn.commit()
        self.log("draft_created", f"#{cur.lastrowid} {kind} [{status}]")
        return self.get_draft(cur.lastrowid)

    def get_draft(self, draft_id: int) -> Draft:
        row = self.conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise KeyError(f"No draft #{draft_id}")
        return Draft.from_row(row)

    def list_drafts(self, status: str | None = None, limit: int = 50) -> list[Draft]:
        if status:
            rows = self.conn.execute(
                "SELECT * FROM drafts WHERE status = ? ORDER BY id DESC LIMIT ?", (status, limit)
            )
        else:
            rows = self.conn.execute("SELECT * FROM drafts ORDER BY id DESC LIMIT ?", (limit,))
        return [Draft.from_row(r) for r in rows]

    def set_status(self, draft_id: int, status: str, *, error: str | None = None) -> Draft:
        self.get_draft(draft_id)  # raises if missing
        self.conn.execute(
            "UPDATE drafts SET status = ?, decided_at = ?, error = ? WHERE id = ?",
            (status, _now(), error, draft_id),
        )
        self.conn.commit()
        self.log(f"draft_{status}", f"#{draft_id}" + (f" {error}" if error else ""))
        return self.get_draft(draft_id)

    def update_text(self, draft_id: int, text: str) -> Draft:
        self.get_draft(draft_id)
        self.conn.execute(
            "UPDATE drafts SET text = ?, status = 'pending', decided_at = NULL WHERE id = ?",
            (text, draft_id),
        )
        self.conn.commit()
        self.log("draft_edited", f"#{draft_id}")
        return self.get_draft(draft_id)

    def mark_published(self, draft_id: int, published_id: str) -> Draft:
        self.conn.execute(
            "UPDATE drafts SET status = 'published', published_at = ?, published_id = ?, error = NULL"
            " WHERE id = ?",
            (_now(), published_id, draft_id),
        )
        self.conn.commit()
        self.log("draft_published", f"#{draft_id} -> {published_id}")
        return self.get_draft(draft_id)

    def recent_published_texts(self, limit: int = 30) -> list[str]:
        rows = self.conn.execute(
            "SELECT text FROM drafts WHERE status IN ('published', 'approved', 'pending')"
            " ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [r["text"] for r in rows]

    # ---- mentions ---------------------------------------------------------
    def upsert_mentions(self, mentions: Iterable[Mention]) -> int:
        new = 0
        for m in mentions:
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO mentions (tweet_id, author, text, created_at, seen_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (m.tweet_id, m.author, m.text, m.created_at, _now()),
            )
            new += cur.rowcount
        self.conn.commit()
        if new:
            self.log("mentions_fetched", f"{new} new")
        return new

    def unhandled_mentions(self, limit: int = 25) -> list[Mention]:
        rows = self.conn.execute(
            "SELECT * FROM mentions WHERE handled = 0 ORDER BY created_at ASC LIMIT ?", (limit,)
        )
        return [
            Mention(r["tweet_id"], r["author"], r["text"], r["created_at"], r["triage"], bool(r["handled"]))
            for r in rows
        ]

    def triage_mention(self, tweet_id: str, triage: str, handled: bool = True) -> None:
        cur = self.conn.execute(
            "UPDATE mentions SET triage = ?, handled = ? WHERE tweet_id = ?",
            (triage, int(handled), tweet_id),
        )
        if cur.rowcount == 0:
            raise KeyError(f"No mention {tweet_id}")
        self.conn.commit()
        self.log("mention_triaged", f"{tweet_id}: {triage}")

    def latest_mention_id(self) -> str | None:
        row = self.conn.execute(
            "SELECT tweet_id FROM mentions ORDER BY CAST(tweet_id AS INTEGER) DESC LIMIT 1"
        ).fetchone()
        return row["tweet_id"] if row else None

    # ---- misc -------------------------------------------------------------
    def log(self, event: str, detail: str | None = None) -> None:
        self.conn.execute("INSERT INTO activity (at, event, detail) VALUES (?, ?, ?)", (_now(), event, detail))
        self.conn.commit()

    def recent_activity(self, limit: int = 50) -> list[tuple[str, str, str | None]]:
        rows = self.conn.execute("SELECT at, event, detail FROM activity ORDER BY id DESC LIMIT ?", (limit,))
        return [(r["at"], r["event"], r["detail"]) for r in rows]

    def get_kv(self, key: str) -> str | None:
        row = self.conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_kv(self, key: str, value: str) -> None:
        self.conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, value))
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()
