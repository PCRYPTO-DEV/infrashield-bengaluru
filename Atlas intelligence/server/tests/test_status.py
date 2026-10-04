"""Status: one honest row per source, with the fix when it is broken."""
from pathlib import Path

from fastapi.testclient import TestClient

from app.status import row, storage_row
from tests.test_cells import make


def test_rows_carry_a_fix_only_when_broken():
    assert row("x", True, "fine", "do this")["fix"] is None
    assert row("x", False, "broken", "do this")["fix"] == "do this"
    assert row("x", None, "not checked")["ok"] is None


def test_storage_says_when_memory_would_be_wiped(tmp_path):
    from app.memory import History
    r = storage_row(tmp_path, History(tmp_path / "m.db"))
    assert r["ok"] is False and "wiped" in r["detail"] and "/var/data" in r["fix"]


def test_status_endpoint_lists_every_source(tmp_path):
    app, _ = make(tmp_path)
    with TestClient(app) as c:
        d = c.get("/api/status").json()
        keys = {r["key"] for r in d["rows"]}
        assert {"deploy", "storage", "tomtom", "writer", "access", "overpass", "news", "weather", "tiles", "trackrecord"} <= keys
        by = {r["key"]: r for r in d["rows"]}
        assert by["access"]["ok"] is False and "ATLAS_PRO_PASSWORD" in by["access"]["fix"]  # defaults in use
        assert by["overpass"]["ok"] is None  # test data: not probed
        assert d["problems"] == sum(1 for r in d["rows"] if r["ok"] is False)
