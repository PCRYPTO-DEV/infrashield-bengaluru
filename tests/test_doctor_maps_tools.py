import base64

from doctor_maps.tools import TOOL_SPECS, ToolResult, api_tool_definitions, describe_call, validate_input


def test_every_tool_schema_is_closed():
    for spec in TOOL_SPECS:
        schema = spec["input_schema"]
        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        for key in schema.get("required", []):
            assert key in schema["properties"]


def test_api_definitions_are_stable_and_eager():
    defs = api_tool_definitions()
    assert [d["name"] for d in defs] == [s["name"] for s in TOOL_SPECS]
    assert all(d["eager_input_streaming"] is True for d in defs)
    assert "eager_input_streaming" not in api_tool_definitions(eager_input_streaming=False)[0]


def test_validate_input_accepts_good_calls():
    assert validate_input("run_pyqgis", {"code": "print(1)"}) is None
    assert validate_input("describe_layer", {"layer": "roads", "sample": 3}) is None
    assert validate_input("render_map", {"layers": ["a", "b"], "extent": [0, 0, 1, 1.5]}) is None
    assert validate_input("run_algorithm", {"algorithm": "native:buffer", "parameters": {"DISTANCE": 5}}) is None


def test_validate_input_rejects_bad_calls():
    assert "Missing required" in validate_input("run_pyqgis", {})
    assert "Unknown tool" in validate_input("nope", {})
    assert "JSON object" in validate_input("run_pyqgis", "print(1)")
    assert "Unexpected parameter" in validate_input("list_layers", {"foo": 1})
    assert "must be of type integer" in validate_input("describe_layer", {"layer": "x", "sample": "3"})
    assert "got boolean" in validate_input("describe_layer", {"layer": "x", "sample": True})
    assert "Items of" in validate_input("render_map", {"layers": ["a", 2]})


def test_tool_result_blocks_and_truncation():
    short = ToolResult(text="hello")
    assert short.to_block("t1") == {"type": "tool_result", "tool_use_id": "t1", "content": "hello"}

    err = ToolResult(text="boom", is_error=True).to_block("t2")
    assert err["is_error"] is True

    long = ToolResult(text="x" * 50_000)
    truncated = long.truncated_text(limit=1_000)
    assert len(truncated) < 1_200 and "truncated" in truncated

    with_image = ToolResult(text="map", images=[b"\x89PNG\r\n"]).to_block("t3")
    content = with_image["content"]
    assert content[0] == {"type": "text", "text": "map"}
    assert content[1]["type"] == "image"
    assert base64.standard_b64decode(content[1]["source"]["data"]) == b"\x89PNG\r\n"

    empty = ToolResult(text="").to_block("t4")
    assert empty["content"] == "(no output)"


def test_tool_result_json_roundtrip():
    original = ToolResult(text="t", images=[b"abc"], is_error=True)
    assert ToolResult.from_json(original.to_json()) == original


def test_describe_call():
    assert describe_call("run_pyqgis", {"code": "x=1\ny=2", "purpose": "set x"}) == "run_pyqgis: set x"
    assert describe_call("run_pyqgis", {"code": "x = 1\ny = 2"}) == "run_pyqgis: x = 1"
    assert describe_call("describe_layer", {"layer": "roads"}).startswith("describe_layer {")
    assert len(describe_call("run_algorithm", {"parameters": {"a": "b" * 500}}, width=60)) <= 80
