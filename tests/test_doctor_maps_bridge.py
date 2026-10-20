import json

import pytest

from doctor_maps import bridge
from doctor_maps.bridge import BridgeClient, BridgeServer
from doctor_maps.tools import ToolResult


class EchoExecutor:
    def execute(self, name, tool_input):
        if name == "render_map":
            return ToolResult(text="rendered", images=[b"\x89PNG"])
        if name == "boom":
            raise RuntimeError("kaboom")
        return ToolResult(text=f"{name}:{json.dumps(tool_input, sort_keys=True)}")


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_DIR", tmp_path)
    monkeypatch.setattr(bridge, "BRIDGE_FILE", tmp_path / "bridge.json")
    srv = BridgeServer(EchoExecutor()).start()
    yield srv
    srv.stop()


def test_roundtrip_including_images(server):
    client = BridgeClient(server.url, server.token)
    assert client.healthy()
    result = client.execute("list_layers", {"a": 1})
    assert result == ToolResult(text='list_layers:{"a": 1}')
    rendered = client.execute("render_map", {})
    assert rendered.images == [b"\x89PNG"] and rendered.text == "rendered"


def test_executor_exception_is_reported_not_raised(server):
    client = BridgeClient(server.url, server.token)
    result = client.execute("boom", {})
    assert result.is_error and "kaboom" in result.text


def test_discovery_file_and_token_check(server, tmp_path):
    data = json.loads((tmp_path / "bridge.json").read_text())
    assert data["url"] == server.url and data["token"] == server.token
    discovered = BridgeClient.discover(tmp_path / "bridge.json")
    assert discovered is not None and discovered.healthy()

    bad = BridgeClient(server.url, "wrong-token")
    assert not bad.healthy()
    assert "HTTP 401" in bad.execute("list_layers", {}).text


def test_stop_removes_discovery_file(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_DIR", tmp_path)
    monkeypatch.setattr(bridge, "BRIDGE_FILE", tmp_path / "bridge.json")
    srv = BridgeServer(EchoExecutor()).start()
    assert (tmp_path / "bridge.json").exists()
    srv.stop()
    assert not (tmp_path / "bridge.json").exists()
    assert BridgeClient.discover(tmp_path / "bridge.json") is None


def test_unreachable_server_is_an_error_result():
    client = BridgeClient("http://127.0.0.1:1", "token", timeout=1)
    assert not client.healthy()
    assert client.execute("list_layers", {}).is_error
