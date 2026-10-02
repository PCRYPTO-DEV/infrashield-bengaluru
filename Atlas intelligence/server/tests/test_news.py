"""Crime headlines from the news: parsed, classified, placed only when a locality is found, kept a day."""
import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.memory import History
from app.news import city_for, kind_of, parse_feed, place_candidates

FIXTURES = Path(__file__).parent / "fixtures"


def test_parsing_and_classification():
    items = parse_feed((FIXTURES / "news_delhi.xml").read_text())
    assert len(items) == 4 and items[0]["title"] == "Two held for chain snatching in Lajpat Nagar" and items[0]["publisher"] == "The Times of India"
    assert kind_of(items[0]["title"]) == "snatching" and kind_of(items[1]["title"]) == "assault" and kind_of(items[2]["title"]) is None
    assert place_candidates(items[0]["title"], "Delhi") == ["Lajpat Nagar"]
    assert place_candidates(items[1]["title"], "Delhi")[0] == "Karol Bagh"
    assert city_for(77.21, 28.63) == ("Delhi", 77.2167, 28.6315) and city_for(70.0, 20.0) is None


def test_news_reports_land_on_the_map_with_approximate_places(tmp_path):
    history = History(tmp_path / "c.db")
    app = create_app(cache=Cache(tmp_path / "c.db"), fixtures=FIXTURES, history=history)
    with TestClient(app) as c:
        r = c.get("/api/reports", params={"bbox": "77.0,28.4,77.4,28.8"}).json()
        news = [i for i in r["items"] if i["source"] == "news"]
        # the two crime headlines with a locality are placed (the search fixture answers every geocode); weather and the no-locality story are not
        assert len(news) == 2 and all(i["precisionM"] in (400.0, 1200.0) for i in news) and all(i["url"].startswith("https://example.com/") for i in news)
        assert news[0]["evidence"]["source"].endswith("place approximate from the headline") and news[0]["publisher"]
        assert r["news"]["city"] == "Delhi" and r["news"]["unplaced"] == 1
        # a second call within 15 minutes does not duplicate
        r2 = c.get("/api/reports", params={"bbox": "77.0,28.4,77.4,28.8"}).json()
        assert len([i for i in r2["items"] if i["source"] == "news"]) == 2
        # people's own reports still work beside them
        c.post("/api/reports", json={"kind": "theft", "lng": 77.2, "lat": 28.6})
        assert c.get("/api/reports", params={"bbox": "77.0,28.4,77.4,28.8"}).json()["count"] == 3
