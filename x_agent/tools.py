"""Tools the agent can call. Every consequential action is gated here, in code,
so the model cannot talk its way past a rule.

Gates:
  * ``draft_post``  -> pending (or approved when X_AGENT_AUTO_PUBLISH_POSTS=true)
  * ``draft_reply`` -> always pending; a human must approve every reply
  * ``publish_approved`` -> only drafts already in status 'approved' are sent
  * numbers, length and banned phrases are validated before a draft is saved
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field

from anthropic import beta_tool

from .config import Settings
from .publishers import Publisher, tweet_length, TWEET_MAX_CHARS
from .store import Store

BANNED_PHRASES = (
    "smart city",
    "smart-city",
    "revolutionary",
    "game-changing",
    "game changing",
    "leverage",
    "real-time monitoring",
    "live outage",
)

_NUMBER_RE = re.compile(r"\d[\d,.]*")


def numbers_in(text: str) -> set[str]:
    return {n.strip(".,").replace(",", "") for n in _NUMBER_RE.findall(text)}


@dataclass
class AgentContext:
    settings: Settings
    store: Store
    publisher: Publisher
    facts_text: str
    posts_drafted_this_run: int = 0
    events: list[str] = field(default_factory=list)

    def note(self, msg: str) -> None:
        self.events.append(msg)


def validate_draft(ctx: AgentContext, text: str, *, kind: str) -> list[str]:
    """Return a list of problems; empty means the draft is acceptable."""
    problems: list[str] = []
    text = text.strip()
    if not text:
        problems.append("text is empty")
        return problems
    n = tweet_length(text)
    if n > TWEET_MAX_CHARS:
        problems.append(f"too long: {n} weighted characters, limit is {TWEET_MAX_CHARS}")
    lowered = text.lower()
    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            problems.append(f"contains banned phrase: {phrase!r}")
    if lowered.count("#") > 1:
        problems.append("more than one hashtag")
    unknown = numbers_in(text) - numbers_in(ctx.facts_text)
    if unknown:
        problems.append(
            "contains numbers not present in facts.md: "
            + ", ".join(sorted(unknown))
            + ". Remove them or ask the owner to add a sourced fact."
        )
    if kind == "post":
        for prior in ctx.store.recent_published_texts(limit=40):
            if difflib.SequenceMatcher(None, lowered, prior.lower()).ratio() > 0.85:
                problems.append("too similar to a recent or queued post; say something new")
                break
    return problems


def make_tools(ctx: AgentContext) -> list:
    s = ctx.settings
    store = ctx.store
    pub = ctx.publisher

    @beta_tool
    def list_queue(status: str = "pending") -> str:
        """List drafts in the approval queue.

        Args:
            status: One of pending, approved, published, rejected, failed, or "all".
        """
        drafts = store.list_drafts(None if status == "all" else status, limit=30)
        if not drafts:
            return f"No drafts with status {status!r}."
        return json.dumps(
            [
                {
                    "id": d.id,
                    "kind": d.kind,
                    "status": d.status,
                    "text": d.text,
                    "in_reply_to": d.in_reply_to,
                    "created_at": d.created_at,
                }
                for d in drafts
            ],
            indent=1,
        )

    @beta_tool
    def recent_posts() -> str:
        """Show the text of recent published, approved and pending posts, so new drafts do not repeat them."""
        texts = store.recent_published_texts(limit=30)
        return "\n---\n".join(texts) if texts else "Nothing has been posted or queued yet."

    @beta_tool
    def draft_post(text: str, rationale: str) -> str:
        """Save a new original post to the approval queue. It is NOT published by this call.

        The draft is validated: 280 weighted characters max, no banned phrases,
        at most one hashtag, and every number must appear in facts.md. If
        validation fails, fix the text and call again.

        Args:
            text: The exact post text.
            rationale: One sentence on why this post, for the human reviewer.
        """
        if ctx.posts_drafted_this_run >= s.max_posts_per_run:
            return f"Refused: already drafted {s.max_posts_per_run} posts this run (X_AGENT_MAX_POSTS_PER_RUN)."
        problems = validate_draft(ctx, text, kind="post")
        if problems:
            return "Rejected, fix and retry:\n- " + "\n- ".join(problems)
        status = "approved" if s.auto_publish_posts else "pending"
        d = store.add_draft("post", text.strip(), rationale=rationale, status=status)
        ctx.posts_drafted_this_run += 1
        ctx.note(f"drafted post #{d.id} [{status}]")
        return f"Saved draft #{d.id} with status {status}. Length {tweet_length(text)}/{TWEET_MAX_CHARS}."

    @beta_tool
    def fetch_mentions() -> str:
        """Fetch new mentions of the account from X and return every mention not yet handled."""
        since = store.latest_mention_id()
        try:
            new = pub.fetch_mentions(since_id=since, limit=50)
        except Exception as e:  # network / auth problems should be visible to the model
            return f"Error fetching mentions from {pub.name}: {e}"
        added = store.upsert_mentions(new)
        pending = store.unhandled_mentions(limit=25)
        if not pending:
            return f"Fetched {added} new mention(s). Nothing is waiting for triage."
        return f"Fetched {added} new mention(s). Unhandled:\n" + json.dumps(
            [
                {"tweet_id": m.tweet_id, "author": m.author, "text": m.text, "created_at": m.created_at}
                for m in pending
            ],
            indent=1,
        )

    @beta_tool
    def draft_reply(tweet_id: str, text: str, rationale: str) -> str:
        """Save a reply to a mention in the approval queue. Replies ALWAYS need human approval.

        Args:
            tweet_id: The id of the mention being answered.
            text: The exact reply text.
            rationale: One sentence for the reviewer on why this reply is appropriate.
        """
        problems = validate_draft(ctx, text, kind="reply")
        if problems:
            return "Rejected, fix and retry:\n- " + "\n- ".join(problems)
        mention = next((m for m in store.unhandled_mentions(limit=200) if m.tweet_id == tweet_id), None)
        d = store.add_draft(
            "reply",
            text.strip(),
            rationale=rationale,
            in_reply_to=tweet_id,
            reply_to_user=mention.author if mention else None,
            status="pending",
        )
        try:
            store.triage_mention(tweet_id, f"reply_drafted:#{d.id}")
        except KeyError:
            pass
        ctx.note(f"drafted reply #{d.id} to {tweet_id}")
        return f"Saved reply draft #{d.id} (pending human approval)."

    @beta_tool
    def flag_mention(tweet_id: str, reason: str) -> str:
        """Mark a mention as needing a human (complaint, press, legal, partnership, investor, anything sensitive). No reply is drafted.

        Args:
            tweet_id: The mention's id.
            reason: Why a human should look at it.
        """
        store.triage_mention(tweet_id, f"needs_human: {reason}")
        ctx.note(f"flagged mention {tweet_id}: {reason}")
        return f"Mention {tweet_id} flagged for a human."

    @beta_tool
    def dismiss_mention(tweet_id: str, reason: str) -> str:
        """Mark a mention as needing no action (spam, bot, unrelated, already answered).

        Args:
            tweet_id: The mention's id.
            reason: Short reason.
        """
        store.triage_mention(tweet_id, f"no_action: {reason}")
        return f"Mention {tweet_id} dismissed."

    @beta_tool
    def get_metrics() -> str:
        """Fetch public metrics (likes, reposts, replies, impressions) for the account's recent posts."""
        try:
            rows = pub.recent_metrics(limit=20)
        except Exception as e:
            return f"Error fetching metrics from {pub.name}: {e}"
        if not rows:
            return f"No metrics available from the {pub.name} publisher."
        return json.dumps(
            [
                {
                    "tweet_id": r.tweet_id,
                    "created_at": r.created_at,
                    "text": r.text,
                    "likes": r.likes,
                    "reposts": r.reposts,
                    "replies": r.replies,
                    "impressions": r.impressions,
                    "quotes": r.quotes,
                }
                for r in rows
            ],
            indent=1,
        )

    @beta_tool
    def publish_approved() -> str:
        """Publish every draft a human has already approved. Pending drafts are never sent."""
        return publish_approved_drafts(ctx)

    @beta_tool
    def leave_note(note: str) -> str:
        """Leave a short note for the account owner in the activity log (observations, suggestions, things you could not do).

        Args:
            note: The note text.
        """
        store.log("agent_note", note)
        ctx.note(f"note: {note}")
        return "Noted."

    return [
        list_queue,
        recent_posts,
        draft_post,
        fetch_mentions,
        draft_reply,
        flag_mention,
        dismiss_mention,
        get_metrics,
        publish_approved,
        leave_note,
    ]


def publish_approved_drafts(ctx: AgentContext) -> str:
    """Shared by the tool and the CLI. Only status='approved' rows are sent."""
    approved = ctx.store.list_drafts("approved", limit=50)
    if not approved:
        return "Nothing approved to publish."
    lines = []
    for d in reversed(approved):  # oldest first
        try:
            result = ctx.publisher.post(d.text, in_reply_to=d.in_reply_to)
        except Exception as e:
            ctx.store.set_status(d.id, "failed", error=str(e))
            lines.append(f"#{d.id} FAILED: {e}")
            continue
        ctx.store.mark_published(d.id, result.published_id)
        ctx.note(f"published #{d.id} -> {result.published_id}")
        lines.append(f"#{d.id} published as {result.published_id}" + (f" {result.url}" if result.url else ""))
    return "\n".join(lines)
