#!/usr/bin/env python3
"""Command-line client for the MiroFish backend API (standard library only).

Pipeline: ontology -> build -> create -> prepare -> start -> report.
`run` does all of it. IDs are saved to .mirofish_state.json so each step can
pick up where the previous one left off.
"""

import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

STATE_FILE = ".mirofish_state.json"
DEFAULT_URL = os.environ.get("MIROFISH_URL", "http://localhost:5001")


class MiroFishError(RuntimeError):
    pass


class Client:
    def __init__(self, base_url, timeout=300):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _send(self, method, path, body=None, headers=None, params=None):
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8"))
            except ValueError:
                raise MiroFishError(f"{method} {path} -> HTTP {e.code}") from None
            raise MiroFishError(f"{method} {path} -> HTTP {e.code}: {payload.get('error')}") from None
        except urllib.error.URLError as e:
            raise MiroFishError(f"Cannot reach MiroFish at {self.base_url}: {e.reason}") from None
        if payload.get("success") is False:
            raise MiroFishError(f"{method} {path}: {payload.get('error') or payload.get('message')}")
        return payload.get("data", payload)

    def get(self, path, **params):
        return self._send("GET", path, params=params)

    def post(self, path, data=None):
        body = json.dumps(data or {}).encode("utf-8")
        return self._send("POST", path, body, {"Content-Type": "application/json"})

    def post_multipart(self, path, fields, files):
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in fields.items():
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8")
            )
        for path_ in files:
            filename = os.path.basename(path_)
            ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            with open(path_, "rb") as f:
                content = f.read()
            parts.append(
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{filename}"\r\n'
                    f"Content-Type: {ctype}\r\n\r\n"
                ).encode("utf-8")
                + content
                + b"\r\n"
            )
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        return self._send(
            "POST", path, b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        )


# ---------- state ----------

def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(**updates):
    state = load_state()
    state.update({k: v for k, v in updates.items() if v is not None})
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    return state


def need(args, key):
    value = getattr(args, key, None) or load_state().get(key)
    if not value:
        raise MiroFishError(f"No {key}: pass --{key.replace('_', '-')} or run the earlier step first")
    return value


def log(msg):
    print(msg, flush=True)


def poll(fetch, done, failed, describe, interval):
    """Call fetch() until done(data) or failed(data); print progress on change."""
    last = None
    while True:
        data = fetch()
        line = describe(data)
        if line != last:
            log("  " + line)
            last = line
        if failed(data):
            raise MiroFishError(f"Failed: {data.get('error') or data.get('message') or data}")
        if done(data):
            return data
        time.sleep(interval)


def task_line(d):
    return f"[{d.get('status')}] {d.get('progress', 0)}% {d.get('message', '')}".rstrip()


# ---------- steps ----------

def step_ontology(c, args):
    missing = [p for p in args.files if not os.path.isfile(p)]
    if missing:
        raise MiroFishError(f"File(s) not found: {', '.join(missing)}")
    log(f"[1/6] Uploading {len(args.files)} file(s) and generating ontology...")
    fields = {"simulation_requirement": args.requirement, "project_name": args.name or "Unnamed Project"}
    if args.context:
        fields["additional_context"] = args.context
    data = c.post_multipart("/api/graph/ontology/generate", fields, args.files)
    onto = data.get("ontology", {})
    log(
        f"  project_id={data['project_id']}  entity types: "
        + ", ".join(e.get("name", "?") for e in onto.get("entity_types", []))
    )
    save_state(project_id=data["project_id"], requirement=args.requirement)
    return data


def step_build(c, args):
    project_id = need(args, "project_id")
    log("[2/6] Building knowledge graph (Zep)...")
    data = c.post("/api/graph/build", {"project_id": project_id})
    graph_id = data.get("graph_id")
    if data.get("task_id"):
        task = poll(
            lambda: c.get(f"/api/graph/task/{data['task_id']}"),
            lambda d: d.get("status") == "completed",
            lambda d: d.get("status") == "failed",
            task_line,
            args.interval,
        )
        result = task.get("result") or {}
        graph_id = result.get("graph_id", graph_id)
        log(f"  graph_id={graph_id}  nodes={result.get('node_count')} edges={result.get('edge_count')}")
    if not graph_id:
        graph_id = c.get(f"/api/graph/project/{project_id}").get("graph_id")
    save_state(graph_id=graph_id)
    return graph_id


def step_create(c, args):
    project_id = need(args, "project_id")
    platform = getattr(args, "platform", "parallel")
    log("[3/6] Creating simulation...")
    data = c.post(
        "/api/simulation/create",
        {
            "project_id": project_id,
            "graph_id": getattr(args, "graph_id", None) or load_state().get("graph_id"),
            "enable_twitter": platform in ("parallel", "twitter"),
            "enable_reddit": platform in ("parallel", "reddit"),
        },
    )
    log(f"  simulation_id={data['simulation_id']}")
    save_state(simulation_id=data["simulation_id"], report_id="")
    return data["simulation_id"]


def step_prepare(c, args):
    sim = need(args, "simulation_id")
    log("[4/6] Preparing environment (personas + config)...")
    data = c.post("/api/simulation/prepare", {"simulation_id": sim})
    if data.get("status") != "ready":
        task_id = data.get("task_id")
        poll(
            lambda: c.post("/api/simulation/prepare/status", {"task_id": task_id, "simulation_id": sim}),
            lambda d: d.get("status") in ("ready", "completed"),
            lambda d: d.get("status") == "failed",
            task_line,
            args.interval,
        )
    log("  environment ready")


def step_start(c, args):
    sim = need(args, "simulation_id")
    body = {
        "simulation_id": sim,
        "platform": args.platform,
        "enable_graph_memory_update": args.memory_update,
        "force": args.force,
    }
    if args.max_rounds:
        body["max_rounds"] = args.max_rounds
    log(f"[5/6] Running simulation ({args.platform}, max_rounds={args.max_rounds or 'config default'})...")
    c.post("/api/simulation/start", body)
    final = poll(
        lambda: c.get(f"/api/simulation/{sim}/run-status"),
        lambda d: d.get("runner_status") in ("completed", "stopped"),
        lambda d: d.get("runner_status") == "failed",
        lambda d: (
            f"[{d.get('runner_status')}] round {d.get('current_round', 0)}/{d.get('total_rounds', '?')}"
            f"  actions={d.get('total_actions_count', 0)}"
        ),
        args.interval,
    )
    log(f"  finished: {final.get('runner_status')}, {final.get('total_actions_count', 0)} actions")


def step_report(c, args):
    sim = need(args, "simulation_id")
    log("[6/6] Generating report (ReportAgent)...")
    data = c.post("/api/report/generate", {"simulation_id": sim, "force_regenerate": args.force})
    report_id = data.get("report_id")
    if data.get("status") != "completed":
        task_id = data.get("task_id")
        done = poll(
            lambda: c.post("/api/report/generate/status", {"task_id": task_id, "simulation_id": sim}),
            lambda d: d.get("status") == "completed",
            lambda d: d.get("status") == "failed",
            task_line,
            args.interval,
        )
        report_id = done.get("report_id") or (done.get("result") or {}).get("report_id") or report_id
    if not report_id:
        report_id = c.get(f"/api/report/by-simulation/{sim}").get("report_id")
    report = c.get(f"/api/report/{report_id}")
    save_state(report_id=report_id)
    text = report.get("markdown_content") or ""
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(text)
    log(f"  report_id={report_id}  saved {len(text)} chars to {args.out}")


def cmd_run(c, args):
    step_ontology(c, args)
    step_build(c, args)
    step_create(c, args)
    step_prepare(c, args)
    step_start(c, args)
    step_report(c, args)
    log(f"\nDone. State in {STATE_FILE}. Next: `chat`, `interview`, `posts`.")


# ---------- exploration ----------

def cmd_ping(c, args):
    c.get("/api/simulation/list")
    log(f"MiroFish backend reachable at {c.base_url}")


def cmd_status(c, args):
    sim = need(args, "simulation_id")
    log(json.dumps({"state": load_state(), "run": c.get(f"/api/simulation/{sim}/run-status")}, indent=2, ensure_ascii=False))


def cmd_posts(c, args):
    sim = need(args, "simulation_id")
    data = c.get(f"/api/simulation/{sim}/posts", platform=args.platform, limit=args.limit, offset=args.offset)
    log(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_chat(c, args):
    sim = need(args, "simulation_id")
    data = c.post("/api/report/chat", {"simulation_id": sim, "message": args.message})
    log(data.get("response", json.dumps(data, ensure_ascii=False)))


def cmd_interview(c, args):
    sim = need(args, "simulation_id")
    if args.all:
        data = c.post("/api/simulation/interview/all", {"simulation_id": sim, "prompt": args.prompt, "platform": args.platform})
    else:
        if args.agent is None:
            raise MiroFishError("Pass --agent N or --all")
        data = c.post(
            "/api/simulation/interview",
            {"simulation_id": sim, "agent_id": args.agent, "prompt": args.prompt, "platform": args.platform},
        )
    log(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_env_status(c, args):
    log(json.dumps(c.post("/api/simulation/env-status", {"simulation_id": need(args, "simulation_id")}), indent=2))


def cmd_close_env(c, args):
    log(json.dumps(c.post("/api/simulation/close-env", {"simulation_id": need(args, "simulation_id")}), indent=2))


def cmd_stop(c, args):
    log(json.dumps(c.post("/api/simulation/stop", {"simulation_id": need(args, "simulation_id")}), indent=2))


# ---------- CLI ----------

def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default=DEFAULT_URL, help="Backend URL (default $MIROFISH_URL or localhost:5001)")
    p.add_argument("--interval", type=float, default=5.0, help="Polling interval in seconds")
    sub = p.add_subparsers(dest="cmd", required=True)

    def ids(sp, *keys):
        for k in keys:
            sp.add_argument("--" + k.replace("_", "-"), dest=k)

    def seed_args(sp):
        sp.add_argument("--files", nargs="+", required=True, help=".pdf/.md/.txt seed documents")
        sp.add_argument("--requirement", required=True, help="Prediction question in natural language")
        sp.add_argument("--name", help="Project name")
        sp.add_argument("--context", help="Additional context for ontology generation")

    def run_args(sp):
        sp.add_argument("--platform", choices=["parallel", "twitter", "reddit"], default="parallel")
        sp.add_argument("--max-rounds", type=int, help="Cap simulation rounds (start with 10-40)")
        sp.add_argument("--memory-update", action="store_true", help="Write agent activity back to Zep graph")
        sp.add_argument("--force", action="store_true", help="Restart / regenerate even if already done")

    sp = sub.add_parser("ping", help="Check the backend is reachable")
    sp.set_defaults(func=cmd_ping)

    sp = sub.add_parser("run", help="Full pipeline: ontology -> report")
    seed_args(sp)
    run_args(sp)
    sp.add_argument("--out", default="mirofish_report.md")
    sp.set_defaults(func=cmd_run)

    sp = sub.add_parser("ontology", help="Step 1: upload seeds, generate ontology")
    seed_args(sp)
    sp.set_defaults(func=step_ontology)

    sp = sub.add_parser("build", help="Step 2: build knowledge graph")
    ids(sp, "project_id")
    sp.set_defaults(func=step_build)

    sp = sub.add_parser("create", help="Step 3: create simulation")
    ids(sp, "project_id", "graph_id")
    sp.add_argument("--platform", choices=["parallel", "twitter", "reddit"], default="parallel")
    sp.set_defaults(func=step_create)

    sp = sub.add_parser("prepare", help="Step 4: generate personas + config")
    ids(sp, "simulation_id")
    sp.set_defaults(func=step_prepare)

    sp = sub.add_parser("start", help="Step 5: run the simulation and wait")
    ids(sp, "simulation_id")
    run_args(sp)
    sp.set_defaults(func=step_start)

    sp = sub.add_parser("report", help="Step 6: generate and save the report")
    ids(sp, "simulation_id")
    sp.add_argument("--force", action="store_true")
    sp.add_argument("--out", default="mirofish_report.md")
    sp.set_defaults(func=step_report)

    sp = sub.add_parser("status", help="Show saved IDs and run status")
    ids(sp, "simulation_id")
    sp.set_defaults(func=cmd_status)

    sp = sub.add_parser("posts", help="List simulated posts")
    ids(sp, "simulation_id")
    sp.add_argument("--platform", choices=["twitter", "reddit"])
    sp.add_argument("--limit", type=int, default=50)
    sp.add_argument("--offset", type=int, default=0)
    sp.set_defaults(func=cmd_posts)

    sp = sub.add_parser("chat", help="Ask the ReportAgent a question")
    ids(sp, "simulation_id")
    sp.add_argument("message")
    sp.set_defaults(func=cmd_chat)

    sp = sub.add_parser("interview", help="Interview one agent (--agent N) or all (--all)")
    ids(sp, "simulation_id")
    sp.add_argument("prompt")
    sp.add_argument("--agent", type=int)
    sp.add_argument("--all", action="store_true")
    sp.add_argument("--platform", choices=["twitter", "reddit"])
    sp.set_defaults(func=cmd_interview)

    for name, func, text in (
        ("env-status", cmd_env_status, "Is the simulation environment alive?"),
        ("close-env", cmd_close_env, "Gracefully close the simulation environment"),
        ("stop", cmd_stop, "Stop a running simulation"),
    ):
        sp = sub.add_parser(name, help=text)
        ids(sp, "simulation_id")
        sp.set_defaults(func=func)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    client = Client(args.base_url)
    try:
        args.func(client, args)
    except MiroFishError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted. The backend keeps running; resume with the next step or `status`.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
