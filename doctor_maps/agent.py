"""The Doctor Maps agent loop: Claude + tools, independent of where tools run.

The loop owns the conversation. Each ``ask()`` appends a user turn and keeps
calling the Messages API until Claude stops asking for tools. Tool calls are
executed through a ``ToolExecutor`` (in-process QGIS, or the bridge to a
running QGIS desktop) and the results are returned in one user message.

API conventions (kept in one place so they are easy to audit):

* streaming requests with ``get_final_message()``; client tools stream their
  input eagerly, so inputs are validated here before execution
* adaptive thinking; depth controlled by ``output_config.effort``
* a static system prompt behind a cache breakpoint plus top-level automatic
  caching for the conversation tail
* server-side refusal fallbacks on by default (``fallbacks="default"``)
* ``refusal`` / ``max_tokens`` / ``pause_turn`` stop reasons handled explicitly
* full assistant content (thinking blocks included) is echoed back unchanged
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .prompts import SYSTEM_PROMPT
from .tools import ToolExecutor, ToolResult, api_tool_definitions, describe_call, validate_input

log = logging.getLogger("doctor_maps")

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


@dataclass
class AgentConfig:
    model: str = field(default_factory=lambda: os.environ.get("DOCTOR_MAPS_MODEL", DEFAULT_MODEL))
    effort: str = field(default_factory=lambda: os.environ.get("DOCTOR_MAPS_EFFORT", "high"))
    max_tokens: int = 64_000
    fallbacks: bool = field(default_factory=lambda: os.environ.get("DOCTOR_MAPS_FALLBACKS", "1") != "0")
    show_thinking: bool = False
    max_tool_rounds: int = 80
    output_dir: Optional[str] = None


@dataclass
class AgentEvent:
    """Something the UI may want to show. ``kind`` is one of:

    text (streamed delta), thinking (summary delta), tool_call, tool_result,
    status, usage, done, error.
    """

    kind: str
    data: Any = None


ConfirmFn = Callable[[str, Dict[str, Any]], bool]
EventFn = Callable[[AgentEvent], None]


class DoctorMapsAgent:
    def __init__(
        self,
        executor: ToolExecutor,
        client=None,
        config: Optional[AgentConfig] = None,
        on_event: Optional[EventFn] = None,
        confirm: Optional[ConfirmFn] = None,
    ):
        self.executor = executor
        self.config = config or AgentConfig()
        self.on_event = on_event or (lambda event: None)
        self.confirm = confirm
        self.messages: List[Dict[str, Any]] = []
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        self._stop_requested = False
        self._client = client

    # ------------------------------------------------------------------ setup
    @property
    def client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic()
        return self._client

    def reset(self) -> None:
        self.messages = []

    def stop(self) -> None:
        """Ask a running ``ask()`` to stop after the current step."""
        self._stop_requested = True

    def _emit(self, kind: str, data: Any = None) -> None:
        try:
            self.on_event(AgentEvent(kind, data))
        except Exception:  # noqa: BLE001 - UI failures must not kill the loop
            log.exception("event handler failed")

    # ---------------------------------------------------------------- request
    def _request_kwargs(self) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            "tools": api_tool_definitions(eager_input_streaming=True),
            "messages": self.messages,
            "thinking": {"type": "adaptive", "display": "summarized" if self.config.show_thinking else "omitted"},
            "output_config": {"effort": self.config.effort},
            "cache_control": {"type": "ephemeral"},
        }
        if self.config.fallbacks:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"
        return kwargs

    def _stream_once(self):
        with self.client.beta.messages.stream(**self._request_kwargs()) as stream:
            for event in stream:
                etype = getattr(event, "type", None)
                if etype == "text":
                    self._emit("text", event.text)
                elif etype == "thinking" and self.config.show_thinking and event.thinking:
                    self._emit("thinking", event.thinking)
                elif etype == "content_block_start":
                    block = getattr(event, "content_block", None)
                    if getattr(block, "type", None) == "tool_use":
                        self._emit("status", f"preparing {block.name}...")
            return stream.get_final_message()

    def _request(self):
        """Stream one assistant turn. A malformed eagerly-streamed tool input raises
        ValueError from the SDK iterator; re-issue once before giving up."""
        try:
            return self._stream_once()
        except ValueError as exc:
            log.warning("stream parse error, retrying once: %s", exc)
            self._emit("status", "retrying after a malformed stream")
            return self._stream_once()

    # ------------------------------------------------------------------ tools
    def _run_tool(self, block) -> Dict[str, Any]:
        name, tool_input = block.name, block.input
        error = validate_input(name, tool_input)
        if error:
            self._emit("tool_result", {"name": name, "text": error, "is_error": True})
            return ToolResult(text=f'{{"INVALID_INPUT": {error!r}}}', is_error=True).to_block(block.id)
        self._emit("tool_call", {"name": name, "input": tool_input, "summary": describe_call(name, tool_input)})
        if self.confirm is not None and not self.confirm(name, tool_input):
            result = ToolResult(text="The user declined to run this tool call. Ask them how to proceed.", is_error=True)
        else:
            try:
                result = self.executor.execute(name, tool_input)
            except Exception as exc:  # noqa: BLE001
                log.exception("tool %s crashed", name)
                result = ToolResult(text=f"Tool crashed: {type(exc).__name__}: {exc}", is_error=True)
        self._emit(
            "tool_result",
            {"name": name, "text": result.truncated_text(), "is_error": result.is_error, "images": list(result.images)},
        )
        return result.to_block(block.id)

    def _record_usage(self, message) -> None:
        usage = getattr(message, "usage", None)
        if usage is None:
            return
        for key in self.usage:
            self.usage[key] += int(getattr(usage, key, 0) or 0)
        self._emit("usage", dict(self.usage))

    # -------------------------------------------------------------------- ask
    def ask(self, user_text: str, context: Optional[str] = None) -> str:
        """Send one user request and run the tool loop until Claude is done.

        ``context`` (for example a QGIS project snapshot) is prepended to the
        user turn inside a ``<qgis_state>`` block. Returns the final text.
        """
        self._stop_requested = False
        content: List[Dict[str, Any]] = []
        if context:
            content.append({"type": "text", "text": f"<qgis_state>\n{context}\n</qgis_state>"})
        content.append({"type": "text", "text": user_text})
        self.messages.append({"role": "user", "content": content})

        final_text = ""
        rounds = 0
        while True:
            message = self._request()
            self._record_usage(message)
            # Echo the whole assistant turn back (thinking blocks included).
            self.messages.append({"role": "assistant", "content": message.content})
            text_blocks = [b.text for b in message.content if getattr(b, "type", None) == "text"]
            if text_blocks:
                final_text = "\n".join(text_blocks)
            tool_blocks = [b for b in message.content if getattr(b, "type", None) == "tool_use"]
            stop = message.stop_reason

            if stop == "refusal":
                details = getattr(message, "stop_details", None)
                reason = getattr(details, "explanation", None) or getattr(details, "category", None) or "policy"
                final_text = final_text or f"Claude declined this request ({reason})."
                self._emit("error", f"request declined: {reason}")
                self._pop_dangling_tool_uses()
                break

            if stop == "max_tokens" and tool_blocks:
                # Eagerly streamed inputs may be truncated: never run them.
                results = [
                    ToolResult(
                        text="Response hit max_tokens before this tool call was complete; the call was not run. "
                        "Retry with a smaller call.",
                        is_error=True,
                    ).to_block(b.id)
                    for b in tool_blocks
                ]
                self.messages.append({"role": "user", "content": results})
                self._emit("status", "response truncated, asking Claude to retry")
                continue

            if stop == "pause_turn":
                continue

            if stop == "tool_use" and tool_blocks:
                rounds += 1
                if rounds > self.config.max_tool_rounds + 2:
                    # Claude ignored the wrap-up request twice; end the turn cleanly.
                    self._pop_dangling_tool_uses()
                    final_text = final_text or "Stopped: the tool budget for this request was exhausted."
                    self._emit("error", "tool budget exhausted")
                    break
                if rounds > self.config.max_tool_rounds:
                    results = [
                        ToolResult(
                            text="Tool budget for this request is exhausted. Summarise what has been done and stop.",
                            is_error=True,
                        ).to_block(b.id)
                        for b in tool_blocks
                    ]
                    self.messages.append({"role": "user", "content": results})
                    continue
                results = [self._run_tool(b) for b in tool_blocks]  # QGIS is single-threaded: sequential
                self.messages.append({"role": "user", "content": results})
                if self._stop_requested:
                    final_text = final_text or "Stopped by the user."
                    self._emit("status", "stopped")
                    break
                continue

            if stop == "max_tokens":
                self.messages.append({"role": "user", "content": "You stopped mid-answer because of the output limit. Continue from where you left off."})
                continue

            break  # end_turn / stop_sequence

        self._emit("done", final_text)
        return final_text

    def _pop_dangling_tool_uses(self) -> None:
        """A refused turn may end with tool_use blocks that never get results; drop them
        so the next request is valid."""
        if not self.messages or self.messages[-1]["role"] != "assistant":
            return
        content = self.messages[-1]["content"]
        kept = [b for b in content if getattr(b, "type", None) != "tool_use"]
        if kept:
            self.messages[-1] = {"role": "assistant", "content": kept}
        else:
            self.messages.pop()


def describe_api_error(exc: Exception) -> str:
    """Turn SDK exceptions into one actionable sentence (most specific first)."""
    try:
        import anthropic
    except ImportError:
        return str(exc)
    if isinstance(exc, anthropic.AuthenticationError):
        return "Authentication failed. Set ANTHROPIC_API_KEY (or run `ant auth login`) and try again."
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "This API key is not allowed to use the requested model."
    if isinstance(exc, anthropic.NotFoundError):
        return f"Model or endpoint not found: {exc.message}"
    if isinstance(exc, anthropic.RateLimitError):
        retry_after = exc.response.headers.get("retry-after", "a few") if getattr(exc, "response", None) else "a few"
        return f"Rate limited. Retry in {retry_after} seconds."
    if isinstance(exc, anthropic.BadRequestError):
        return f"The API rejected the request: {exc.message}"
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code >= 500:
            return f"Anthropic server error ({exc.status_code}). Retry shortly."
        return f"API error {exc.status_code}: {exc.message}"
    if isinstance(exc, anthropic.APITimeoutError):
        return "The request timed out. Retry, or lower the effort level."
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach the Anthropic API. Check your network connection and proxy settings."
    return f"{type(exc).__name__}: {exc}"
