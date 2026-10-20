"""Agent loop tests against a scripted fake of the Anthropic client."""
from types import SimpleNamespace

import pytest

from doctor_maps.agent import FALLBACK_BETA, AgentConfig, DoctorMapsAgent
from doctor_maps.prompts import SYSTEM_PROMPT
from doctor_maps.tools import ToolResult


# ----------------------------------------------------------------- fakes
def text_block(text):
    return SimpleNamespace(type="text", text=text)


def thinking_block():
    return SimpleNamespace(type="thinking", thinking="", signature="sig")


def tool_block(name, tool_input, block_id="toolu_1"):
    return SimpleNamespace(type="tool_use", id=block_id, name=name, input=tool_input)


def message(blocks, stop_reason="end_turn", stop_details=None):
    return SimpleNamespace(
        content=blocks,
        stop_reason=stop_reason,
        stop_details=stop_details,
        usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=2, cache_creation_input_tokens=1),
    )


class FakeStream:
    def __init__(self, msg, raise_value_error=False):
        self.msg = msg
        self.raise_value_error = raise_value_error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        if self.raise_value_error:
            raise ValueError("malformed partial json")
        for block in self.msg.content:
            if block.type == "text":
                yield SimpleNamespace(type="text", text=block.text, snapshot=block.text)
            elif block.type == "tool_use":
                yield SimpleNamespace(type="content_block_start", content_block=block)

    def get_final_message(self):
        return self.msg


class FakeClient:
    """``client.beta.messages.stream(**kwargs)`` returns scripted turns in order."""

    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **kwargs):
        self.calls.append(kwargs)
        turn = self.turns.pop(0)
        if isinstance(turn, FakeStream):
            return turn
        return FakeStream(turn)


class RecordingExecutor:
    def __init__(self):
        self.calls = []

    def execute(self, name, tool_input):
        self.calls.append((name, tool_input))
        if name == "list_layers":
            return ToolResult(text="2 layers: roads, rivers")
        if name == "render_map":
            return ToolResult(text="rendered", images=[b"png-bytes"])
        return ToolResult(text=f"ran {name}")


def make_agent(turns, **kwargs):
    client = FakeClient(turns)
    executor = RecordingExecutor()
    events = []
    agent = DoctorMapsAgent(executor, client=client, on_event=events.append, config=AgentConfig(model="claude-opus-5-5"), **kwargs)
    return agent, client, executor, events


# ----------------------------------------------------------------- tests
def test_tool_loop_runs_tool_and_returns_final_text():
    agent, client, executor, events = make_agent([
        message([thinking_block(), text_block("Let me look."), tool_block("list_layers", {})], stop_reason="tool_use"),
        message([text_block("You have roads and rivers.")]),
    ])
    answer = agent.ask("what layers do I have?", context="QGIS 3.34 | 2 layers")

    assert answer == "You have roads and rivers."
    assert executor.calls == [("list_layers", {})]
    roles = [m["role"] for m in agent.messages]
    assert roles == ["user", "assistant", "user", "assistant"]
    # context block + user text in the first turn
    first = agent.messages[0]["content"]
    assert first[0]["text"].startswith("<qgis_state>") and first[1]["text"] == "what layers do I have?"
    # thinking block echoed back unchanged
    assert agent.messages[1]["content"][0].type == "thinking"
    # tool result in one user message, matched by id
    result_msg = agent.messages[2]["content"]
    assert result_msg == [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "2 layers: roads, rivers"}]
    kinds = [e.kind for e in events]
    assert kinds.count("tool_call") == 1 and kinds.count("tool_result") == 1 and kinds[-1] == "done"
    assert agent.usage["input_tokens"] == 20 and agent.usage["cache_read_input_tokens"] == 4


def test_request_shape_follows_api_conventions():
    agent, client, *_ = make_agent([message([text_block("hi")])])
    agent.ask("hello")
    kwargs = client.calls[0]
    assert kwargs["model"] == "claude-opus-5-5"
    assert kwargs["system"][0]["text"] == SYSTEM_PROMPT
    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert kwargs["cache_control"] == {"type": "ephemeral"}
    assert kwargs["thinking"] == {"type": "adaptive", "display": "omitted"}
    assert kwargs["output_config"] == {"effort": "high"}
    assert kwargs["betas"] == [FALLBACK_BETA] and kwargs["fallbacks"] == "default"
    assert all(t["eager_input_streaming"] for t in kwargs["tools"])
    assert kwargs["messages"] is agent.messages


def test_fallbacks_can_be_disabled():
    client = FakeClient([message([text_block("hi")])])
    agent = DoctorMapsAgent(RecordingExecutor(), client=client, config=AgentConfig(fallbacks=False))
    agent.ask("hello")
    assert "fallbacks" not in client.calls[0] and "betas" not in client.calls[0]


def test_invalid_tool_input_is_not_executed():
    agent, client, executor, events = make_agent([
        message([tool_block("describe_layer", {"sample": "five"})], stop_reason="tool_use"),
        message([text_block("sorry")]),
    ])
    agent.ask("describe")
    assert executor.calls == []
    block = agent.messages[2]["content"][0]
    assert block["is_error"] is True and "INVALID_INPUT" in block["content"]


def test_max_tokens_with_tool_use_is_not_executed():
    agent, client, executor, events = make_agent([
        message([tool_block("run_pyqgis", {"code": "print("})], stop_reason="max_tokens"),
        message([text_block("retrying smaller")]),
    ])
    agent.ask("do a thing")
    assert executor.calls == []
    block = agent.messages[2]["content"][0]
    assert block["is_error"] is True and "max_tokens" in block["content"]


def test_max_tokens_without_tools_asks_to_continue():
    agent, client, executor, events = make_agent([
        message([text_block("part one")], stop_reason="max_tokens"),
        message([text_block("part two")]),
    ])
    answer = agent.ask("write")
    assert answer == "part two"
    assert agent.messages[2]["content"].startswith("You stopped mid-answer")


def test_refusal_drops_dangling_tool_use():
    details = SimpleNamespace(category="cyber", explanation="not allowed")
    agent, client, executor, events = make_agent([
        message([text_block("I will"), tool_block("run_pyqgis", {"code": "x"})], stop_reason="refusal", stop_details=details),
    ])
    answer = agent.ask("do evil")
    assert executor.calls == []
    assert answer == "I will"
    assert [b.type for b in agent.messages[-1]["content"]] == ["text"]
    assert any(e.kind == "error" and "not allowed" in e.data for e in events)


def test_confirm_callback_can_decline():
    agent, client, executor, events = make_agent(
        [
            message([tool_block("run_pyqgis", {"code": "print(1)"})], stop_reason="tool_use"),
            message([text_block("ok, not running it")]),
        ],
        confirm=lambda name, tool_input: False,
    )
    agent.ask("run")
    assert executor.calls == []
    block = agent.messages[2]["content"][0]
    assert block["is_error"] is True and "declined" in block["content"]


def test_image_results_become_image_blocks():
    agent, client, executor, events = make_agent([
        message([tool_block("render_map", {"width": 200})], stop_reason="tool_use"),
        message([text_block("looks good")]),
    ])
    agent.ask("show me")
    content = agent.messages[2]["content"][0]["content"]
    assert content[0]["type"] == "text" and content[1]["type"] == "image"
    assert any(e.kind == "tool_result" and e.data["images"] == [b"png-bytes"] for e in events)


def test_parallel_tool_calls_return_all_results_in_one_message():
    agent, client, executor, events = make_agent([
        message([tool_block("list_layers", {}, "a"), tool_block("project_summary", {}, "b")], stop_reason="tool_use"),
        message([text_block("done")]),
    ])
    agent.ask("inspect")
    ids = [b["tool_use_id"] for b in agent.messages[2]["content"]]
    assert ids == ["a", "b"] and len(executor.calls) == 2


def test_malformed_stream_is_retried_once():
    good = message([text_block("recovered")])
    agent, client, executor, events = make_agent([FakeStream(good, raise_value_error=True), good])
    assert agent.ask("hi") == "recovered"
    assert len(client.calls) == 2


def test_pause_turn_resends():
    agent, client, executor, events = make_agent([
        message([text_block("working")], stop_reason="pause_turn"),
        message([text_block("finished")]),
    ])
    assert agent.ask("go") == "finished"
    assert len(client.calls) == 2


def test_stop_request_ends_after_current_round():
    agent, client, executor, events = make_agent([
        message([tool_block("list_layers", {})], stop_reason="tool_use"),
        message([tool_block("list_layers", {}, "second")], stop_reason="tool_use"),
        message([text_block("never reached")]),
    ])
    # stop() arrives from another thread while a tool is running; simulate it from the event hook
    agent.on_event = lambda e: agent.stop() if e.kind == "tool_call" else None
    answer = agent.ask("loop")
    assert answer == "Stopped by the user."
    assert len(client.calls) == 1 and len(executor.calls) == 1


def test_tool_budget_exhaustion_forces_wrap_up():
    turns = [message([tool_block("list_layers", {}, f"t{i}")], stop_reason="tool_use") for i in range(4)]
    turns.append(message([text_block("summary")]))
    client = FakeClient(turns)
    executor = RecordingExecutor()
    agent = DoctorMapsAgent(executor, client=client, config=AgentConfig(max_tool_rounds=2))
    assert agent.ask("loop forever") == "summary"
    assert len(executor.calls) == 2
    budget_blocks = [
        m["content"][0] for m in agent.messages
        if m["role"] == "user" and isinstance(m["content"], list) and isinstance(m["content"][0], dict)
        and m["content"][0].get("type") == "tool_result" and "budget" in str(m["content"][0]["content"])
    ]
    assert len(budget_blocks) == 2  # t2 and t3 were refused with the wrap-up message


def test_tool_budget_hard_cap_ends_turn_cleanly():
    turns = [message([tool_block("list_layers", {}, f"t{i}")], stop_reason="tool_use") for i in range(6)]
    client = FakeClient(turns)
    agent = DoctorMapsAgent(RecordingExecutor(), client=client, config=AgentConfig(max_tool_rounds=1))
    answer = agent.ask("loop forever")
    assert "exhausted" in answer
    assert len(client.calls) == 4  # 1 allowed + 2 wrap-up chances + the one that got cut
    # no dangling tool_use at the end of the history
    assert all(getattr(b, "type", None) != "tool_use" for b in agent.messages[-1]["content"]) or agent.messages[-1]["role"] == "user"


def test_reset_clears_history():
    agent, *_ = make_agent([message([text_block("a")]), message([text_block("b")])])
    agent.ask("one")
    agent.reset()
    agent.ask("two")
    assert len(agent.messages) == 2


@pytest.mark.parametrize("effort", ["low", "max"])
def test_effort_from_config(effort):
    client = FakeClient([message([text_block("hi")])])
    agent = DoctorMapsAgent(RecordingExecutor(), client=client, config=AgentConfig(effort=effort))
    agent.ask("hello")
    assert client.calls[0]["output_config"] == {"effort": effort}
