"""Bridge: lets a terminal agent drive a running QGIS desktop.

``BridgeServer`` runs inside QGIS (started by the plugin). It listens on
localhost only, requires a random token, and hands every tool call to a
``ToolExecutor`` - in the plugin that executor marshals onto the Qt main
thread. ``BridgeClient`` is the matching ``ToolExecutor`` used by the CLI.

Connection details are written to ``~/.doctor_maps/bridge.json`` (mode 0600)
so the CLI finds the server without configuration.
"""
from __future__ import annotations

import json
import os
import secrets
import socket
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional

from .tools import ToolExecutor, ToolResult

BRIDGE_DIR = Path(os.environ.get("DOCTOR_MAPS_HOME", Path.home() / ".doctor_maps"))
BRIDGE_FILE = BRIDGE_DIR / "bridge.json"
DEFAULT_HOST = "127.0.0.1"


class _Handler(BaseHTTPRequestHandler):
    server: "BridgeServer"

    def log_message(self, fmt, *args):  # silence default stderr logging
        return

    def _send(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        return secrets.compare_digest(header, f"Bearer {self.server.token}")

    def do_GET(self):  # noqa: N802
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        self._send(200, {"ok": True, "pid": os.getpid(), "name": "doctor-maps-bridge"})

    def do_POST(self):  # noqa: N802
        if self.path != "/execute":
            return self._send(404, {"error": "not found"})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            name = payload["name"]
            tool_input = payload.get("input") or {}
        except (ValueError, KeyError) as exc:
            return self._send(400, {"error": f"bad request: {exc}"})
        try:
            result = self.server.executor.execute(name, tool_input)
        except Exception as exc:  # noqa: BLE001
            result = ToolResult(text=f"Bridge execution failed: {type(exc).__name__}: {exc}", is_error=True)
        self._send(200, result.to_json())


class BridgeServer:
    """Localhost HTTP server that executes tool calls through ``executor``."""

    def __init__(self, executor: ToolExecutor, host: str = DEFAULT_HOST, port: int = 0, token: Optional[str] = None):
        self.executor = executor
        self.token = token or secrets.token_urlsafe(32)
        self._httpd = ThreadingHTTPServer((host, port), _Handler)
        self._httpd.executor = executor  # type: ignore[attr-defined]
        self._httpd.token = self.token  # type: ignore[attr-defined]
        self._thread: Optional[threading.Thread] = None
        self.host, self.port = self._httpd.server_address[:2]

    def start(self, write_discovery_file: bool = True) -> "BridgeServer":
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="doctor-maps-bridge", daemon=True)
        self._thread.start()
        if write_discovery_file:
            self.write_discovery_file()
        return self

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        if BRIDGE_FILE.exists():
            try:
                data = json.loads(BRIDGE_FILE.read_text())
                if data.get("token") == self.token:
                    BRIDGE_FILE.unlink()
            except (OSError, ValueError):
                pass

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def write_discovery_file(self) -> Path:
        BRIDGE_DIR.mkdir(parents=True, exist_ok=True)
        data = {"url": self.url, "token": self.token, "pid": os.getpid()}
        tmp = BRIDGE_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(data))
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, BRIDGE_FILE)
        return BRIDGE_FILE


class BridgeClient:
    """``ToolExecutor`` that forwards calls to a ``BridgeServer`` inside QGIS."""

    def __init__(self, url: str, token: str, timeout: float = 600.0):
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout

    @classmethod
    def discover(cls, path: Path = BRIDGE_FILE) -> Optional["BridgeClient"]:
        """Return a client for the bridge described in the discovery file, if it answers."""
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            client = cls(data["url"], data["token"])
        except (OSError, ValueError, KeyError):
            return None
        return client if client.healthy() else None

    def _request(self, method: str, route: str, payload: Optional[Dict[str, Any]] = None, timeout: Optional[float] = None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            self.url + route,
            data=body,
            method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def healthy(self) -> bool:
        try:
            return bool(self._request("GET", "/health", timeout=2.0).get("ok"))
        except (urllib.error.URLError, socket.timeout, ValueError, OSError):
            return False

    def execute(self, name: str, tool_input: Dict[str, Any]) -> ToolResult:
        try:
            data = self._request("POST", "/execute", {"name": name, "input": tool_input})
        except urllib.error.HTTPError as exc:
            return ToolResult(text=f"Bridge rejected the call: HTTP {exc.code}", is_error=True)
        except (urllib.error.URLError, socket.timeout, OSError) as exc:
            return ToolResult(text=f"Lost the connection to QGIS: {exc}", is_error=True)
        return ToolResult.from_json(data)
