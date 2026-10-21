"""The agent loop: Claude + the gated tools in ``x_agent.tools``."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import anthropic

from .config import Settings
from .publishers import build_publisher
from .store import Store
from .tools import AgentContext, make_tools

log = logging.getLogger(__name__)

SYSTEM_TEMPLATE = """You manage the X (Twitter) account @{handle} ("{display_name}") for Polymath InfraShield Bengaluru.

You work for the account owner, who reviews everything you draft. Your job is to keep
the account active, accurate and on-voice while making the owner's review quick:
good drafts, clear rationales, and honest notes when something needs them.

Hard rules (also enforced in code, so do not try to work around them):
1. You never publish anything yourself except drafts a human has already approved.
2. Every reply to another person goes to the approval queue. Always.
3. You only state facts and numbers that appear in the FACTS section below. If a
   useful fact is missing, leave it out and mention the gap in a note to the owner.
4. Complaints, press, legal, partnership, investor or hiring enquiries: flag them
   for a human, never answer them.
5. Follow the VOICE guide. When in doubt, be quieter and more specific.

Working style:
- Look before you write: check recent posts and the queue so you do not repeat yourself.
- Draft the number of posts the task asks for, no more. Quality over volume.
- Finish with a short plain-text summary for the owner: what you drafted, what you
  flagged, what you could not do and why. No markdown headers.

======== VOICE ========
{voice}

======== FACTS ========
{facts}
"""

MISSIONS = {
    "daily": (
        "Daily run. 1) Fetch and triage new mentions: draft replies where facts allow, flag "
        "anything sensitive, dismiss noise. 2) Review recent posts and the pending queue. "
        "3) Draft up to {n} new original posts for the owner to review, each a different "
        "post shape from the voice guide. 4) Publish anything already approved. Then summarise."
    ),
    "mentions": (
        "Fetch new mentions and triage every unhandled one: draft a reply, flag for a human, "
        "or dismiss. Do not draft original posts. Then summarise."
    ),
    "report": (
        "Pull metrics for recent posts. Explain plainly which posts did best and worst and "
        "why you think so. Do not draft posts. Leave one note for the owner with three "
        "concrete content directions for next week, grounded in the facts file."
    ),
    "ideas": (
        "Draft up to {n} original posts for the owner to review. Cover different post "
        "shapes and different CRS dimensions. Do not fetch mentions. Then summarise."
    ),
}


def build_context(settings: Settings, store: Store | None = None, publisher=None) -> AgentContext:
    store = store or Store(settings.db_path)
    publisher = publisher or build_publisher(settings)
    facts = settings.facts_path.read_text(encoding="utf-8") if settings.facts_path.is_file() else ""
    return AgentContext(settings=settings, store=store, publisher=publisher, facts_text=facts)


def build_system_prompt(settings: Settings, facts_text: str) -> str:
    voice = settings.voice_path.read_text(encoding="utf-8") if settings.voice_path.is_file() else ""
    return SYSTEM_TEMPLATE.format(
        handle=settings.handle,
        display_name=settings.display_name,
        voice=voice.strip(),
        facts=facts_text.strip(),
    )


def mission_text(name: str, settings: Settings) -> str:
    try:
        return MISSIONS[name].format(n=settings.max_posts_per_run)
    except KeyError:
        raise ValueError(f"Unknown mission {name!r}; choose from {', '.join(MISSIONS)}") from None


def run_agent(
    instruction: str,
    ctx: AgentContext,
    client: anthropic.Anthropic | None = None,
    on_message=None,
) -> str:
    """Run one agent session and return its final summary text."""
    client = client or anthropic.Anthropic()
    settings = ctx.settings
    now = datetime.now(ZoneInfo(settings.timezone)).strftime("%A %d %B %Y, %H:%M %Z")
    user_message = (
        f"Current time: {now}. Publisher in use: {ctx.publisher.name} ({ctx.publisher.whoami()}).\n"
        f"Original posts auto-approved: {'yes' if settings.auto_publish_posts else 'no'}.\n\n"
        f"Task: {instruction}"
    )
    runner = client.beta.messages.tool_runner(
        model=settings.model,
        max_tokens=16000,
        system=[{"type": "text", "text": build_system_prompt(settings, ctx.facts_text), "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": settings.effort},
        # If a safety classifier declines a turn, the API re-runs it on a fallback model
        # inside the same call instead of silently ending the run.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        tools=make_tools(ctx),
        messages=[{"role": "user", "content": user_message}],
    )
    final_text = ""
    last = None
    for message in runner:
        last = message
        if on_message:
            on_message(message)
        for block in message.content:
            if block.type == "text" and block.text.strip():
                final_text = block.text
            elif block.type == "tool_use":
                log.info("tool call: %s %s", block.name, block.input)
    if last is not None and last.stop_reason == "refusal":
        detail = getattr(last, "stop_details", None)
        reason = getattr(detail, "explanation", None) or "no explanation given"
        ctx.store.log("agent_refusal", reason)
        return f"The model declined to complete this run: {reason}"
    if last is not None and last.stop_reason == "max_tokens":
        ctx.store.log("agent_truncated", "hit max_tokens")
    ctx.store.log("agent_run", instruction[:200])
    return final_text.strip() or "(the agent finished without a summary)"
