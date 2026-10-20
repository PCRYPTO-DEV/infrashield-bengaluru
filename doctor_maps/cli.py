"""Terminal front-end: ``python -m doctor_maps`` / ``doctor-maps``.

Two ways to reach QGIS:

* **bridge** - a running QGIS desktop with the Doctor Maps plugin enabled.
  Everything the agent builds appears live in that QGIS window.
* **headless** - a standalone QgsApplication in this process. Needs the QGIS
  Python bindings on the interpreter running this command.

``auto`` (the default) prefers the bridge and falls back to headless.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Optional, Tuple

from .agent import AgentConfig, AgentEvent, DoctorMapsAgent, describe_api_error
from .tools import LocalExecutor, ToolExecutor

BANNER = "Doctor Maps - tell me what to build in QGIS. Commands: /layers /reset /render [path] /save [path] /quit"


def _color(code: str, text: str) -> str:
    if not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="doctor-maps", description="A Claude-powered agent that builds anything in QGIS.")
    p.add_argument("prompt", nargs="*", help="Request to run once. Omit for an interactive session.")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--bridge", action="store_const", const="bridge", dest="mode", help="Only use a running QGIS desktop (Doctor Maps plugin).")
    mode.add_argument("--headless", action="store_const", const="headless", dest="mode", help="Only use a standalone QGIS in this process.")
    p.set_defaults(mode="auto")
    p.add_argument("--project", help="Project file (.qgz/.qgs) to open first.")
    p.add_argument("--load", action="append", default=[], metavar="FILE", help="Data file(s) to load before starting (repeatable).")
    p.add_argument("--output-dir", help="Where the agent should write files (default: project home or cwd).")
    p.add_argument("--model", default=None, help="Model id (default: claude-opus-5-5 or $DOCTOR_MAPS_MODEL).")
    p.add_argument("--effort", default=None, choices=["low", "medium", "high", "xhigh", "max"], help="Reasoning effort (default high).")
    p.add_argument("--confirm", action="store_true", help="Ask before every run_pyqgis / run_algorithm call.")
    p.add_argument("--no-fallbacks", action="store_true", help="Disable server-side refusal fallbacks.")
    p.add_argument("--show-thinking", action="store_true", help="Print Claude's summarised reasoning.")
    p.add_argument("--quiet", action="store_true", help="Hide tool-call progress lines.")
    return p


def make_executor(args) -> Tuple[ToolExecutor, Optional[object]]:
    """Return (executor, runtime). ``runtime`` is None in bridge mode."""
    if args.mode in ("auto", "bridge"):
        from .bridge import BridgeClient

        client = BridgeClient.discover()
        if client is not None:
            print(_color("2", f"Connected to QGIS desktop via bridge at {client.url}"))
            return client, None
        if args.mode == "bridge":
            sys.exit(
                "No running QGIS bridge found. Open QGIS, enable the Doctor Maps plugin "
                "(Plugins > Manage and Install) and make sure 'Allow terminal connections' is on."
            )
    try:
        import qgis.core  # noqa: F401 - probe before starting anything

        from .qgis_runtime import QgisRuntime
    except ImportError as exc:
        sys.exit(
            f"PyQGIS is not importable in this interpreter ({exc}).\n"
            "Run this command with the Python that ships with QGIS, for example:\n"
            "  Linux:   /usr/bin/python3 -m doctor_maps ...\n"
            "  Windows: OSGeo4W Shell > python -m doctor_maps ...\n"
            "  macOS:   /Applications/QGIS.app/Contents/MacOS/bin/python3 -m doctor_maps ...\n"
            "or open QGIS and use the Doctor Maps plugin dock / bridge instead."
        )
    runtime = QgisRuntime.headless(output_dir=args.output_dir)
    if args.project:
        print(runtime.open_project(args.project))
    for path in args.load:
        print(runtime.load_layer(path))
    print(_color("2", f"Headless QGIS {runtime.qgis_version()} started"))
    return LocalExecutor(runtime), runtime


class ConsoleUI:
    def __init__(self, quiet: bool = False, show_thinking: bool = False):
        self.quiet = quiet
        self.show_thinking = show_thinking
        self._line_open = False

    def _newline(self):
        if self._line_open:
            print()
            self._line_open = False

    def on_event(self, event: AgentEvent) -> None:
        if event.kind == "text":
            print(event.data, end="", flush=True)
            self._line_open = True
        elif event.kind == "thinking" and self.show_thinking:
            print(_color("2", event.data), end="", flush=True)
            self._line_open = True
        elif event.kind == "tool_call" and not self.quiet:
            self._newline()
            print(_color("36", f"  > {event.data['summary']}"))
        elif event.kind == "tool_result" and not self.quiet:
            first = (event.data["text"] or "").strip().splitlines()[:1]
            label = "  x " if event.data["is_error"] else "  . "
            colour = "31" if event.data["is_error"] else "2"
            print(_color(colour, f"{label}{first[0][:160] if first else '(no output)'}"))
        elif event.kind == "status" and not self.quiet:
            self._newline()
            print(_color("2", f"  [{event.data}]"))
        elif event.kind == "error":
            self._newline()
            print(_color("31", f"  ! {event.data}"))
        elif event.kind == "done":
            self._newline()

    def confirm(self, name: str, tool_input) -> bool:
        self._newline()
        if name == "run_pyqgis":
            print(_color("33", "--- code Doctor Maps wants to run ---"))
            print(tool_input.get("code", ""))
            print(_color("33", "-------------------------------------"))
        else:
            print(_color("33", f"--- {name}: {tool_input}"))
        try:
            answer = input("Run it? [Y/n] ").strip().lower()
        except EOFError:
            return False
        return answer in ("", "y", "yes")


def _handle_command(line: str, agent: DoctorMapsAgent, executor: ToolExecutor) -> bool:
    """Handle slash commands. Returns True when the line was a command."""
    parts = line.strip().split(maxsplit=1)
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""
    if cmd in ("/quit", "/exit", "/q"):
        raise EOFError
    if cmd == "/reset":
        agent.reset()
        print("Conversation cleared.")
    elif cmd == "/layers":
        print(executor.execute("list_layers", {}).text)
    elif cmd == "/render":
        res = executor.execute("render_map", {"path": arg or "doctor_maps_map.png"})
        print(res.text)
    elif cmd == "/save":
        print(executor.execute("save_project", {"path": arg} if arg else {}).text)
    elif cmd == "/usage":
        print(agent.usage)
    else:
        return False
    return True


def run_request(agent: DoctorMapsAgent, executor: ToolExecutor, text: str) -> int:
    context = executor.execute("project_summary", {}).text
    try:
        agent.ask(text, context=context)
    except KeyboardInterrupt:
        print("\n(interrupted)")
        return 130
    except Exception as exc:  # noqa: BLE001 - keep the session alive, explain what went wrong
        try:
            import anthropic

            if isinstance(exc, anthropic.AnthropicError):
                print(_color("31", describe_api_error(exc)))
                return 1
        except ImportError:
            pass
        raise
    return 0


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.model:
        os.environ["DOCTOR_MAPS_MODEL"] = args.model
    if args.effort:
        os.environ["DOCTOR_MAPS_EFFORT"] = args.effort
    try:
        import anthropic  # noqa: F401
    except ImportError:
        sys.exit("The Anthropic SDK is missing: pip install anthropic")

    executor, runtime = make_executor(args)
    ui = ConsoleUI(quiet=args.quiet, show_thinking=args.show_thinking)
    config = AgentConfig(show_thinking=args.show_thinking, output_dir=args.output_dir)
    if args.no_fallbacks:
        config.fallbacks = False
    agent = DoctorMapsAgent(executor, config=config, on_event=ui.on_event, confirm=ui.confirm if args.confirm else None)

    try:
        if args.prompt:
            return run_request(agent, executor, " ".join(args.prompt))
        print(BANNER)
        while True:
            try:
                line = input(_color("1", "you> ")).strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not line:
                continue
            if line.startswith("/"):
                try:
                    if _handle_command(line, agent, executor):
                        continue
                except EOFError:
                    break
                print("Unknown command.")
                continue
            run_request(agent, executor, line)
        return 0
    finally:
        if runtime is not None:
            runtime.close()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
