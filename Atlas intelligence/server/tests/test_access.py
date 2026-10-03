"""Plus and Pro are checked on the server: passwords from the environment, signed tokens, 403 without one."""
import time

from fastapi.testclient import TestClient

from app.access import Access
from app.cache import Cache
from tests.test_cells import LAT, LNG, make


def test_tokens_are_signed_and_expire(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_PRO_PASSWORD", "river-stone-42")
    monkeypatch.setenv("ATLAS_SECRET", "s3cret")
    a = Access(Cache(tmp_path / "a.db"))
    assert a.tier_for("atbose-pro") is None  # the old default stops working once a real password is set
    assert a.tier_for(" river-stone-42 ") == "pro" and a.tier_for("atbose") == "plus"
    t = a.sign("pro")
    assert a.verify(t) == "pro"
    body, sig = t.rsplit(".", 1)
    assert a.verify(body + "." + sig[:-2] + "xx") == "free"  # forged signature
    assert a.verify(a.sign("pro", now=time.time() - 40 * 86400)) == "free"  # expired
    assert a.verify(None) == "free" and a.verify("garbage") == "free"
    other = Access(Cache(tmp_path / "b.db"))
    monkeypatch.setenv("ATLAS_SECRET", "different")
    assert Access(Cache(tmp_path / "c.db")).verify(t) == "free"  # another secret cannot read it
    assert a.report() == {"plusPasswordSet": False, "proPasswordSet": True, "secretSet": True} and other.report()["secretSet"]


def test_pro_endpoints_need_a_pro_token(tmp_path):
    app, _ = make(tmp_path)
    with TestClient(app) as c:
        p = {"lng": LNG, "lat": LAT}
        assert c.get("/api/gentrification", params=p).status_code == 403
        assert c.get("/api/invest", params=p).status_code == 403
        assert c.get("/api/sites", params={"bbox": f"{LNG - 0.005},{LAT - 0.005},{LNG + 0.005},{LAT + 0.005}"}).status_code == 403
        plus = c.post("/api/unlock", json={"password": "atbose"}).json()
        assert plus["tier"] == "plus"
        assert c.get("/api/invest", params=p, headers={"X-Atlas-Token": plus["token"]}).status_code == 403  # Plus is not Pro
        pro = c.post("/api/unlock", json={"password": "atbose-pro"}).json()
        assert c.get("/api/invest", params=p, headers={"X-Atlas-Token": pro["token"]}).status_code == 200
        assert c.get("/api/unlock/check", headers={"X-Atlas-Token": pro["token"]}).json()["tier"] == "pro"
        # the free parts stay open
        assert c.get("/api/place", params=p).status_code == 200 and c.get("/api/trackrecord").status_code == 200


def test_wrong_passwords_are_limited(tmp_path):
    app, _ = make(tmp_path)
    with TestClient(app) as c:
        codes = [c.post("/api/unlock", json={"password": f"guess{i}"}).status_code for i in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429
