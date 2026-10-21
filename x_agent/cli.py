"""Command-line entry point.

    python -m x_agent daily            # triage mentions, draft posts, publish approved
    python -m x_agent mentions         # triage mentions only
    python -m x_agent ideas            # draft posts only
    python -m x_agent report           # metrics review + content directions
    python -m x_agent run "..."        # free-form instruction
    python -m x_agent queue [status]   # show the approval queue
    python -m x_agent show ID
    python -m x_agent approve ID [ID...]
    python -m x_agent reject ID [ID...]
    python -m x_agent edit ID "new text"
    python -m x_agent publish          # send approved drafts to the configured publisher
    python -m x_agent log              # recent activity
    python -m x_agent whoami           # which publisher/account is wired in
"""

from __future__ import annotations

import argparse
import logging
import sys
import textwrap

from .agent import MISSIONS, build_context, mission_text, run_agent
from .config import Settings
from .publishers import tweet_length
from .store import Store
from .tools import publish_approved_drafts, validate_draft


def _print_draft(d, verbose: bool = True) -> None:
    head = f"#{d.id} [{d.status}] {d.kind}"
    if d.in_reply_to:
        head += f" -> reply to {d.in_reply_to}" + (f" (@{d.reply_to_user})" if d.reply_to_user else "")
    print(head)
    print(textwrap.indent(d.text, "    "))
    if verbose:
        if d.rationale:
            print(f"    why: {d.rationale}")
        if d.published_id:
            print(f"    published: {d.published_id}")
        if d.error:
            print(f"    error: {d.error}")
    print(f"    ({tweet_length(d.text)}/280 chars, created {d.created_at})")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="x_agent", description="InfraShield X account manager")
    parser.add_argument("-v", "--verbose", action="store_true", help="log tool calls")
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in MISSIONS:
        sub.add_parser(name, help=MISSIONS[name][:60] + "...")
    p_run = sub.add_parser("run", help="free-form instruction to the agent")
    p_run.add_argument("instruction")

    p_queue = sub.add_parser("queue", help="show drafts")
    p_queue.add_argument("status", nargs="?", default="pending")
    p_show = sub.add_parser("show")
    p_show.add_argument("id", type=int)
    p_approve = sub.add_parser("approve")
    p_approve.add_argument("ids", type=int, nargs="+")
    p_reject = sub.add_parser("reject")
    p_reject.add_argument("ids", type=int, nargs="+")
    p_edit = sub.add_parser("edit", help="replace a draft's text (it goes back to pending)")
    p_edit.add_argument("id", type=int)
    p_edit.add_argument("text")
    sub.add_parser("publish", help="send approved drafts")
    p_log = sub.add_parser("log")
    p_log.add_argument("-n", type=int, default=30)
    sub.add_parser("whoami")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")

    settings = Settings.from_env()
    store = Store(settings.db_path)

    # --- commands that never touch Claude or the network -------------------
    if args.cmd == "queue":
        drafts = store.list_drafts(None if args.status == "all" else args.status)
        if not drafts:
            print(f"No {args.status} drafts.")
        for d in drafts:
            _print_draft(d, verbose=False)
        return 0
    if args.cmd == "show":
        _print_draft(store.get_draft(args.id))
        return 0
    if args.cmd in {"approve", "reject"}:
        status = "approved" if args.cmd == "approve" else "rejected"
        for i in args.ids:
            d = store.get_draft(i)
            if d.status not in {"pending", "approved", "rejected", "failed"}:
                print(f"#{i} is {d.status}; leaving it alone")
                continue
            store.set_status(i, status)
            print(f"#{i} -> {status}")
        if status == "approved":
            print("Run `python -m x_agent publish` to send approved drafts.")
        return 0
    if args.cmd == "edit":
        ctx = build_context(settings, store=store, publisher=_NullPublisher())
        d = store.get_draft(args.id)
        problems = validate_draft(ctx, args.text, kind=d.kind)
        if problems:
            print("Not saved:\n- " + "\n- ".join(problems))
            return 1
        _print_draft(store.update_text(args.id, args.text))
        return 0
    if args.cmd == "log":
        for at, event, detail in store.recent_activity(args.n):
            print(f"{at}  {event:18s} {detail or ''}")
        return 0

    # --- commands that need a publisher -------------------------------------
    try:
        ctx = build_context(settings, store=store)
    except ValueError as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        return 2

    if args.cmd == "whoami":
        print(f"publisher: {ctx.publisher.name}  account: {ctx.publisher.whoami()}")
        print(f"model: {settings.model}  effort: {settings.effort}  auto-publish posts: {settings.auto_publish_posts}")
        print(f"db: {settings.db_path}")
        return 0
    if args.cmd == "publish":
        print(publish_approved_drafts(ctx))
        return 0

    # --- agent runs ---------------------------------------------------------
    instruction = args.instruction if args.cmd == "run" else mission_text(args.cmd, settings)
    summary = run_agent(instruction, ctx)
    print(summary)
    pending = store.list_drafts("pending")
    if pending:
        print(f"\n{len(pending)} draft(s) waiting for your approval. Review with `python -m x_agent queue`.")
    return 0


class _NullPublisher:
    name = "none"

    def whoami(self) -> str:
        return "none"

    def post(self, text, in_reply_to=None):
        raise RuntimeError("no publisher")

    def fetch_mentions(self, since_id=None, limit=25):
        return []

    def recent_metrics(self, limit=20):
        return []


if __name__ == "__main__":
    sys.exit(main())
