from fastapi.testclient import TestClient

from app.cache import Cache
from app.explain import EchoWriter, Fact, build_prompt, SYSTEM
from app.main import create_app


def client(writer=None):
    return TestClient(create_app(Cache(":memory:"), writer=writer))


def test_prompt_carries_only_the_facts_and_their_labels():
    facts = [Fact(id="a", classification="observed", statement="Ring Road is at half speed", source="tomtom", confidence=0.9),
             Fact(id="b", classification="predicted", statement="It may clear in 20 minutes")]
    p = build_prompt("Why is traffic slow?", facts, "hi", "why_slow")
    assert "Language: Hindi" in p and "Why is traffic slow?" in p
    assert "[observed → say 'हमने देखा'] Ring Road is at half speed (confidence 90%)" in p
    assert "[predicted → say 'मॉडल का अनुमान'] It may clear in 20 minutes" in p
    assert "Never add a number" in SYSTEM


def test_endpoints_without_a_key_say_so():
    c = client()
    r = c.post("/api/explain", json={"question": "q", "intent": "help", "evidence": [{"statement": "x"}]})
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    assert c.get("/api/writer/status").json()["configured"] is False


def test_echo_writer_rewrites_facts_and_refuses_empty_evidence():
    c = client(EchoWriter())
    r = c.post("/api/explain", json={"question": "Why is traffic slow?", "intent": "why_slow", "evidence": [
        {"classification": "observed", "statement": "Ring Road is at half speed"}, {"classification": "derived", "statement": "5 cars are on it"}]})
    assert r.status_code == 200
    body = r.json()
    assert body["writer"] == "echo-writer" and body["text"] == "Ring Road is at half speed. 5 cars are on it."
    assert c.post("/api/explain", json={"question": "q", "evidence": []}).status_code == 400
    free = c.post("/api/ask", json={"question": "Is it raining?", "language": "hi", "snapshot": [{"classification": "observed", "statement": "Weather: clear sky, 31 °C"}]})
    assert free.status_code == 200 and free.json()["language"] == "hi" and "clear sky" in free.json()["text"]


def test_chat_keeps_the_thread_and_returns_actions():
    c = client(EchoWriter())
    body = {"language": "en", "context": {"city": "Delhi"}, "facts": [{"classification": "observed", "statement": "Janpath is at 30% of free speed"}],
            "messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hello!"}, {"role": "user", "content": "why is Janpath slow?"}]}
    r = c.post("/api/chat", json=body)
    assert r.status_code == 200
    j = r.json()
    assert j["text"].startswith("(turn 2) You asked: why is Janpath slow?") and "Janpath is at 30%" in j["text"] and j["actions"] == []
    assert c.post("/api/chat", json={**body, "messages": [{"role": "assistant", "content": "x"}]}).status_code == 400

    class Tagger(EchoWriter):
        def chat(self, system, messages, max_tokens=900):  # noqa: ARG002
            return "Yesterday was slower here. [[time:past]]"
    r = client(Tagger()).post("/api/chat", json=body).json()
    assert r["text"] == "Yesterday was slower here." and r["actions"] == ["time:past"]
