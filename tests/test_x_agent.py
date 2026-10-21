"""Offline tests for the X agent: store, validation gates, publishing gate, CLI.

No network and no Claude calls. The agent loop itself is exercised with a fake
client in ``test_run_agent_with_fake_client``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from x_agent import agent as agent_mod  # noqa: E402
from x_agent.config import Settings  # noqa: E402
from x_agent.publishers import DryRunPublisher, PostMetrics, tweet_length  # noqa: E402
from x_agent.store import Mention, Store  # noqa: E402
from x_agent.tools import AgentContext, make_tools, publish_approved_drafts, validate_draft  # noqa: E402

FACTS = "CRS runs from 0 to 100. Status: MVP v1.0.\n"


@pytest.fixture
def ctx(tmp_path):
    settings = Settings(db_path=tmp_path / "t.db", publisher="dryrun", max_posts_per_run=2)
    store = Store(settings.db_path)
    return AgentContext(settings=settings, store=store, publisher=DryRunPublisher(), facts_text=FACTS)


def tool_map(ctx):
    return {t.name: t for t in make_tools(ctx)}


def call(tool, **kwargs):
    return tool.call(kwargs)


# ---------------------------------------------------------------- store
def test_store_roundtrip(tmp_path):
    s = Store(tmp_path / "a.db")
    d = s.add_draft("post", "hello", rationale="r")
    assert d.status == "pending"
    assert s.set_status(d.id, "approved").status == "approved"
    assert s.mark_published(d.id, "123").published_id == "123"
    assert [x.id for x in s.list_drafts("published")] == [d.id]
    with pytest.raises(KeyError):
        s.get_draft(999)


def test_mentions_dedupe_and_since(tmp_path):
    s = Store(tmp_path / "m.db")
    ms = [Mention("10", "a", "hi", None), Mention("12", "b", "yo", None)]
    assert s.upsert_mentions(ms) == 2
    assert s.upsert_mentions(ms) == 0
    assert s.latest_mention_id() == "12"
    s.triage_mention("10", "no_action: spam")
    assert [m.tweet_id for m in s.unhandled_mentions()] == ["12"]


# ---------------------------------------------------------------- validation gates
def test_tweet_length_counts_urls_as_23():
    assert tweet_length("see https://example.com/a/very/long/path/indeed ok") == len("see ") + 23 + len(" ok")


def test_validate_rejects_unknown_numbers_and_banned(ctx):
    problems = validate_draft(ctx, "We cut outages by 40% with our smart city tool", kind="post")
    joined = " ".join(problems)
    assert "40" in joined and "banned phrase" in joined


def test_validate_allows_numbers_from_facts(ctx):
    assert validate_draft(ctx, "The CRS runs from 0 to 100 and explains its drivers.", kind="post") == []


def test_validate_rejects_long_and_duplicate(ctx):
    assert any("too long" in p for p in validate_draft(ctx, "x" * 281, kind="post"))
    ctx.store.add_draft("post", "Hospital admins: before the monsoon, check your backup power.")
    dup = validate_draft(ctx, "Hospital admins: before the monsoon, check your backup power!", kind="post")
    assert any("too similar" in p for p in dup)


# ---------------------------------------------------------------- tools + gates
def test_draft_post_goes_to_pending_and_respects_cap(ctx):
    t = tool_map(ctx)
    r1 = call(t["draft_post"], text="One observation about Bellandur flooding and facility access.", rationale="shape 1")
    assert "status pending" in r1
    call(t["draft_post"], text="A short explainer of the heat exposure dimension of CRS.", rationale="shape 2")
    r3 = call(t["draft_post"], text="Third post that should be refused by the cap.", rationale="x")
    assert r3.startswith("Refused")
    assert len(ctx.store.list_drafts("pending")) == 2
    assert ctx.publisher.posted == []  # nothing sent


def test_auto_publish_flag_only_affects_posts(ctx):
    ctx.settings.auto_publish_posts = True
    t = tool_map(ctx)
    call(t["draft_post"], text="Auto approved post about pre-monsoon planning.", rationale="r")
    ctx.publisher.canned_mentions = [Mention("55", "someone", "@infrashield what is CRS?", None)]
    call(t["fetch_mentions"])
    r = call(t["draft_reply"], tweet_id="55", text="CRS is our Continuity Risk Score, 0 to 100.", rationale="r")
    assert "pending" in r
    kinds = {(d.kind, d.status) for d in ctx.store.list_drafts("all" if False else None)}
    assert ("post", "approved") in kinds and ("reply", "pending") in kinds


def test_publish_only_sends_approved(ctx):
    t = tool_map(ctx)
    call(t["draft_post"], text="Pending post stays pending.", rationale="r")
    d = ctx.store.add_draft("post", "Approved post goes out.", status="approved")
    out = publish_approved_drafts(ctx)
    assert f"#{d.id} published" in out
    assert [p["text"] for p in ctx.publisher.posted] == ["Approved post goes out."]
    assert ctx.store.get_draft(d.id).status == "published"
    assert len(ctx.store.list_drafts("pending")) == 1


def test_publish_failure_is_recorded(ctx):
    class Boom(DryRunPublisher):
        def post(self, text, in_reply_to=None):
            raise RuntimeError("403 forbidden")

    ctx.publisher = Boom()
    d = ctx.store.add_draft("post", "x", status="approved")
    assert "FAILED" in publish_approved_drafts(ctx)
    assert ctx.store.get_draft(d.id).status == "failed"


def test_flag_and_dismiss_mentions(ctx):
    ctx.publisher.canned_mentions = [Mention("1", "press", "journalist here", None), Mention("2", "bot", "buy now", None)]
    t = tool_map(ctx)
    assert "2 new" in call(t["fetch_mentions"])
    call(t["flag_mention"], tweet_id="1", reason="press enquiry")
    call(t["dismiss_mention"], tweet_id="2", reason="spam")
    assert ctx.store.unhandled_mentions() == []
    assert any("needs_human" in (d or "") for _, _, d in ctx.store.recent_activity())


def test_get_metrics(ctx):
    ctx.publisher.canned_metrics = [PostMetrics("9", "post", None, likes=3, impressions=100)]
    out = call(tool_map(ctx)["get_metrics"])
    assert '"likes": 3' in out


# ---------------------------------------------------------------- agent loop with a fake client
class _FakeRunner:
    def __init__(self, tools, final_text):
        self.tools = {t.name: t for t in tools}
        self.final_text = final_text

    def __iter__(self):
        # Simulate Claude calling draft_post once, then finishing with a summary.
        self.tools["draft_post"].call({"text": "A planning prompt for hospital admins before the monsoon.", "rationale": "r"})
        yield SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", name="draft_post", input={})], stop_reason="tool_use"
        )
        yield SimpleNamespace(content=[SimpleNamespace(type="text", text=self.final_text)], stop_reason="end_turn")


class _FakeClient:
    def __init__(self):
        self.kwargs = None
        self.beta = SimpleNamespace(messages=SimpleNamespace(tool_runner=self._tool_runner))

    def _tool_runner(self, **kwargs):
        self.kwargs = kwargs
        return _FakeRunner(kwargs["tools"], "Drafted one post for review.")


def test_run_agent_with_fake_client(ctx):
    client = _FakeClient()
    summary = agent_mod.run_agent("ideas", ctx, client=client)
    assert summary == "Drafted one post for review."
    assert client.kwargs["model"] == "claude-opus-5-5"
    assert client.kwargs["output_config"] == {"effort": "medium"}
    assert "thinking" not in client.kwargs and "tool_choice" not in client.kwargs
    assert client.kwargs["fallbacks"] == "default"
    assert client.kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "FACTS" in client.kwargs["system"][0]["text"]
    assert "@globerasia" in client.kwargs["system"][0]["text"]
    assert len(ctx.store.list_drafts("pending")) == 1


def test_mission_text_and_unknown(ctx):
    assert "up to 2" in agent_mod.mission_text("daily", ctx.settings)
    with pytest.raises(ValueError):
        agent_mod.mission_text("nope", ctx.settings)


# ---------------------------------------------------------------- settings
def test_settings_validate_publisher(monkeypatch):
    s = Settings(publisher="x")
    with pytest.raises(ValueError):
        s.validate_publisher()
    s = Settings(publisher="dryrun")
    s.validate_publisher()
    monkeypatch.setenv("X_AGENT_PUBLISHER", "DRYRUN")
    monkeypatch.setenv("X_AGENT_AUTO_PUBLISH_POSTS", "yes")
    monkeypatch.setenv("X_AGENT_HANDLE", "@globerasia")
    s = Settings.from_env(dotenv=None)
    assert s.publisher == "dryrun" and s.auto_publish_posts is True
    assert s.handle == "globerasia" and s.display_name == "globereader"


# ---------------------------------------------------------------- CLI
def test_cli_queue_approve_publish(tmp_path, monkeypatch, capsys):
    from x_agent.cli import main

    monkeypatch.setenv("X_AGENT_DB_PATH", str(tmp_path / "cli.db"))
    monkeypatch.setenv("X_AGENT_PUBLISHER", "dryrun")
    store = Store(tmp_path / "cli.db")
    d = store.add_draft("post", "A post the owner will approve.")
    store.close()

    assert main(["queue"]) == 0
    assert "A post the owner will approve." in capsys.readouterr().out
    assert main(["approve", str(d.id)]) == 0
    assert main(["publish"]) == 0
    assert "published as dryrun-" in capsys.readouterr().out
    assert main(["edit", str(d.id), "contains 99 made up"]) == 1
    assert main(["log"]) == 0
    assert main(["whoami"]) == 0
