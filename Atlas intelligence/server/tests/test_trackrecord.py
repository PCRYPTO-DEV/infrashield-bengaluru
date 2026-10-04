"""Track record: predictions checked against what actually happened, next to a 'nothing changes' guess."""
import time

from fastapi.testclient import TestClient

from app.trackrecord import rank, score_locality, spearman, summarise, traffic_backtest
from tests.test_cells import make


def rows(prem, ring=(1000,) * 7):
    return {m: {"total": 100, "premium": p, "food": 10, "ring": r} for m, p, r in zip((36, 30, 24, 18, 12, 6, 0), prem, ring)}


def test_rank_and_spearman():
    assert rank([3, 1, 2]) == [3, 1, 2] and rank([1, 1, 2]) == [1.5, 1.5, 3]
    assert spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) == 1.0
    assert spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) == -1.0
    assert spearman([1, 2, 3], [1, 2, 3]) is None  # too few points
    assert spearman([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]) is None  # nothing to rank


def test_a_steady_trend_is_predicted_inside_its_band():
    r = score_locality("Steady", rows((2, 4, 6, 8, 10, 12, 14)))
    assert r["inBand12"] and r["inBand6"] and r["ape12"] < 0.05
    assert r["apeNaive12"] > r["ape12"]  # beats "nothing changes"
    assert r["predictedChange"] > 0 and r["actualChange"] == 4.0


def test_a_surprise_is_reported_as_a_miss():
    r = score_locality("Surprise", rows((2, 4, 6, 8, 10, 11, 30)))
    assert not r["inBand12"] and r["ape12"] > 0.3


def test_ring_growth_is_taken_out():
    # premium grows exactly as fast as the whole 5 km ring: no real change left
    r = score_locality("Mapping drive", rows((10, 11, 12, 13, 14, 15, 16), ring=(1000, 1100, 1200, 1300, 1400, 1500, 1600)))
    assert abs(r["actualChange"]) < 0.01


def test_incomplete_history_is_skipped_and_summary_is_honest():
    assert score_locality("Gap", {36: {"total": 1, "premium": 1, "food": 1, "ring": 1}}) is None
    res = [score_locality(f"L{i}", rows((i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6 + (i % 3)))) for i in range(1, 10)]
    s = summarise(res)
    assert s["localities"] == 9 and 0 <= s["inBandShare12"] <= 1 and s["directionOutOf"] >= 1
    assert "medianErrorNaivePct" in s and s["topThirdActualChange"] >= s["bottomThirdActualChange"] - 5
    assert summarise([]) is None


def test_traffic_backtest_uses_only_earlier_readings(tmp_path):
    from app.memory import History
    h = History(tmp_path / "m.db")
    now = time.time()
    # four weeks of the same hour reading ~0.6, then a recent day at 0.62
    for w in range(1, 5):
        h.record_flow("12/1/1", [{"id": "s1", "trafficLevel": 0.6, "roadType": "x", "coordinates": [[77.0, 28.0]]}], ts=now - w * 7 * 86400 - 86400)
    h.record_flow("12/1/1", [{"id": "s1", "trafficLevel": 0.62, "roadType": "x", "coordinates": [[77.0, 28.0]]}], ts=now - 86400)
    out = traffic_backtest(h, now=now)
    assert out["status"] == "ok" and out["checked"] >= 1 and out["within10"] == 1.0
    empty = traffic_backtest(History(tmp_path / "e.db"), now=now)
    assert empty["status"] == "waiting"


def test_endpoint_runs_and_reports(tmp_path):
    app, _ = make(tmp_path)
    with TestClient(app) as c:
        first = c.get("/api/trackrecord").json()
        assert first["gentrification"]["status"] in ("running", "ok") and first["traffic"]["status"] in ("waiting", "ok")
        for _ in range(40):
            g = c.get("/api/trackrecord").json()["gentrification"]
            if g["status"] == "ok":
                break
            time.sleep(0.05)
        assert g["status"] == "ok" and g["summary"]["localities"] >= 1 and "Not a price" in g["method"]
