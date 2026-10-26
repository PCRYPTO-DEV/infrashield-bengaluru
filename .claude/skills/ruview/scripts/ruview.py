#!/usr/bin/env python3
"""Command-line client for the RuView sensing-server REST API (standard library only).

Reads RUVIEW_URL (default http://localhost:3000) and RUVIEW_API_TOKEN from the
environment. /api/v1/* requires the token; /health does not.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = os.environ.get("RUVIEW_URL", "http://localhost:3000")


class RuViewError(RuntimeError):
    pass


class Client:
    def __init__(self, base_url, token=None, timeout=15):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def request(self, method, path, data=None):
        if not path.startswith("/"):
            path = "/" + path
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base_url + path, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:300]
            hint = ""
            if e.code == 401:
                hint = " (set RUVIEW_API_TOKEN to the token the server was started with)"
            elif e.code == 421:
                hint = " (server rejects this host; set SENSING_ALLOWED_HOSTS on the server)"
            raise RuViewError(f"{method} {path} -> HTTP {e.code}{hint}: {detail}") from None
        except urllib.error.URLError as e:
            raise RuViewError(f"Cannot reach RuView at {self.base_url}: {e.reason}") from None
        try:
            return json.loads(raw)
        except ValueError:
            return raw  # e.g. Prometheus text from /api/v1/mesh/metrics

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, data=None):
        return self.request("POST", path, data if data is not None else {})


def show(data):
    print(data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False))


def cmd_health(c, args):
    data = c.get("/health")
    show(data)
    if isinstance(data, dict) and data.get("source") == "simulated":
        print("note: source=simulated, so all sensing values are synthetic", file=sys.stderr)


def cmd_watch(c, args):
    end = time.time() + args.seconds
    while time.time() < end:
        v = c.get("/api/v1/vital-signs")
        print(
            f"{time.strftime('%H:%M:%S')}  breathing={v.get('breathing_bpm')} bpm "
            f"(conf {v.get('breathing_confidence')})  heart={v.get('heart_bpm')} bpm "
            f"(conf {v.get('heart_confidence')})  motion={v.get('motion_level')}",
            flush=True,
        )
        time.sleep(args.interval)


def cmd_record(c, args):
    if args.action == "start":
        body = {"session_name": args.name or time.strftime("session-%Y%m%d-%H%M%S")}
        if args.label:
            body["label"] = args.label
        if args.duration:
            body["duration_secs"] = args.duration
        show(c.post("/api/v1/recording/start", body))
    elif args.action == "stop":
        show(c.post("/api/v1/recording/stop"))
    else:
        show(c.get("/api/v1/recording/list"))


def cmd_node_sync(c, args):
    show(c.get(f"/api/v1/nodes/{args.node_id}/sync"))


def simple(path):
    return lambda c, args: show(c.get(path))


SIMPLE = {
    "info": ("/api/v1/info", "Server version, build, uptime"),
    "sensing": ("/api/v1/sensing/latest", "Latest CSI sensing frame"),
    "vitals": ("/api/v1/vital-signs", "Breathing + heart rate + confidence"),
    "pose": ("/api/v1/pose/current", "17-keypoint pose per detected person"),
    "nodes": ("/api/v1/nodes", "Connected CSI nodes"),
    "mesh": ("/api/v1/mesh", "Fleet mesh sync map (ADR-110)"),
    "models": ("/api/v1/models", "Available RVF model files"),
    "field": ("/api/field", "Latest signed RuField events"),
}


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default=DEFAULT_URL, help="Server URL (default $RUVIEW_URL or localhost:3000)")
    p.add_argument("--token", default=os.environ.get("RUVIEW_API_TOKEN"), help="API token (default $RUVIEW_API_TOKEN)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("health", help="Liveness + data source (no token needed)").set_defaults(func=cmd_health)
    for name, (path, text) in SIMPLE.items():
        sub.add_parser(name, help=text).set_defaults(func=simple(path))

    sp = sub.add_parser("node-sync", help="One node's mesh sync state")
    sp.add_argument("node_id")
    sp.set_defaults(func=cmd_node_sync)

    sp = sub.add_parser("watch", help="Poll vital signs")
    sp.add_argument("--seconds", type=float, default=30)
    sp.add_argument("--interval", type=float, default=2)
    sp.set_defaults(func=cmd_watch)

    sp = sub.add_parser("record", help="CSI recording sessions")
    sp.add_argument("action", choices=["start", "stop", "list"])
    sp.add_argument("--name", help="Session name (start only; default timestamped)")
    sp.add_argument("--label", help="Activity label, e.g. empty, walking (start only)")
    sp.add_argument("--duration", type=int, help="Auto-stop after N seconds (start only)")
    sp.set_defaults(func=cmd_record)

    sp = sub.add_parser("get", help="GET any endpoint, e.g. /api/v1/models/active")
    sp.add_argument("path")
    sp.set_defaults(func=lambda c, a: show(c.get(a.path)))

    sp = sub.add_parser("post", help="POST JSON to any endpoint")
    sp.add_argument("path")
    sp.add_argument("json", nargs="?", default="{}", help="JSON body (default {})")
    sp.set_defaults(func=lambda c, a: show(c.post(a.path, json.loads(a.json))))
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    client = Client(args.base_url, args.token)
    try:
        args.func(client, args)
    except RuViewError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON body: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
