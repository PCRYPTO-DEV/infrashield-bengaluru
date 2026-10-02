"""A small SQLite key/value cache with per-entry TTL. Good enough for tiles and feeds."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


class Cache:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, fetched_at REAL NOT NULL, ttl REAL NOT NULL)"
        )
        self._conn.execute("CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL)")
        self._conn.commit()

    def get(self, key: str, now: float | None = None) -> Any | None:
        now = time.time() if now is None else now
        with self._lock:
            row = self._conn.execute("SELECT v, fetched_at, ttl FROM kv WHERE k = ?", (key,)).fetchone()
        if not row:
            return None
        v, fetched_at, ttl = row
        if ttl > 0 and now - fetched_at > ttl:
            return None
        return json.loads(v)

    def set(self, key: str, value: Any, ttl: float, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO kv (k, v, fetched_at, ttl) VALUES (?, ?, ?, ?)",
                (key, json.dumps(value, separators=(",", ":")), now, ttl),
            )
            self._conn.commit()

    def age(self, key: str, now: float | None = None) -> float | None:
        now = time.time() if now is None else now
        with self._lock:
            row = self._conn.execute("SELECT fetched_at FROM kv WHERE k = ?", (key,)).fetchone()
        return None if not row else now - row[0]

    def increment(self, key: str, by: int = 1) -> int:
        with self._lock:
            self._conn.execute(
                "INSERT INTO counters (k, n) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET n = n + excluded.n", (key, by)
            )
            self._conn.commit()
            return int(self._conn.execute("SELECT n FROM counters WHERE k = ?", (key,)).fetchone()[0])

    def count(self, key: str) -> int:
        with self._lock:
            row = self._conn.execute("SELECT n FROM counters WHERE k = ?", (key,)).fetchone()
        return int(row[0]) if row else 0
