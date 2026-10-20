"""Tool definitions shared by every execution backend.

The schemas are what Claude sees. Execution is delegated to a ``ToolExecutor``:
``LocalExecutor`` runs against a ``QgisRuntime`` in this process, and
``doctor_maps.bridge.BridgeClient`` forwards calls to a running QGIS desktop.

Every tool is a client tool streamed with ``eager_input_streaming`` so large
code bodies arrive as they are generated. That turns off server-side input
validation, so ``validate_input`` runs on every call before execution.
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

MAX_TOOL_OUTPUT_CHARS = 12_000

TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "name": "run_pyqgis",
        "description": (
            "Execute Python code inside the live QGIS session. Pre-imported: everything from "
            "qgis.core, qgis.gui and qgis.analysis, QtCore/QtGui (QVariant, QColor, QRectF, ...), "
            "`processing`, `project` (QgsProject.instance()) and `iface` (None when headless). "
            "Variables persist between calls. Assign `result = ...` to return a value; printed "
            "output is returned too. Use this for anything the other tools do not cover."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python source to execute."},
                "purpose": {
                    "type": "string",
                    "description": "One short sentence saying what this code does (shown to the user).",
                },
            },
            "required": ["code"],
            "additionalProperties": False,
        },
    },
    {
        "name": "project_summary",
        "description": (
            "Summarise the current QGIS project: file path, CRS, extent, layers, print layouts, "
            "home folder and QGIS version."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_layers",
        "description": (
            "List all layers in the project with id, name, type, geometry, CRS, feature count, "
            "visibility and data source."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "describe_layer",
        "description": (
            "Describe one layer in detail: fields and types, CRS, extent, feature count, renderer, "
            "and a few sample features (vector) or band statistics (raster)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "layer": {"type": "string", "description": "Layer name or id."},
                "sample": {
                    "type": "integer",
                    "description": "Number of sample features to include (default 5).",
                },
            },
            "required": ["layer"],
            "additionalProperties": False,
        },
    },
    {
        "name": "load_layer",
        "description": (
            "Load a file or data source as a layer and add it to the project. Handles vector files "
            "(ogr), rasters (gdal), CSV with coordinate columns (delimitedtext) and provider URIs "
            "such as XYZ tiles, WMS, WFS or PostGIS."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "File path or provider URI."},
                "name": {"type": "string", "description": "Layer name (default: file stem)."},
                "provider": {
                    "type": "string",
                    "description": "Provider key: ogr, gdal, delimitedtext, wms, wfs, postgres, memory. Auto-detected when omitted.",
                },
                "x_field": {"type": "string", "description": "CSV longitude/x column (delimitedtext)."},
                "y_field": {"type": "string", "description": "CSV latitude/y column (delimitedtext)."},
                "crs": {"type": "string", "description": "CRS for CSV points, e.g. EPSG:4326."},
            },
            "required": ["source"],
            "additionalProperties": False,
        },
    },
    {
        "name": "search_algorithms",
        "description": "Search the Processing toolbox by keyword. Returns algorithm ids, names and groups.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords, e.g. 'buffer', 'zonal statistics', 'heatmap'."},
                "limit": {"type": "integer", "description": "Maximum results (default 25)."},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "describe_algorithm",
        "description": "Show a Processing algorithm's help, parameters (name, type, default, options) and outputs.",
        "input_schema": {
            "type": "object",
            "properties": {
                "algorithm": {"type": "string", "description": "Algorithm id, e.g. native:buffer."}
            },
            "required": ["algorithm"],
            "additionalProperties": False,
        },
    },
    {
        "name": "run_algorithm",
        "description": (
            "Run a Processing algorithm. Layer parameters accept layer names, ids or file paths. "
            "Missing output parameters default to temporary outputs. Result layers are added to the "
            "project unless load_outputs is false."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "algorithm": {"type": "string", "description": "Algorithm id, e.g. native:buffer."},
                "parameters": {
                    "type": "object",
                    "description": "Parameter name -> value mapping as described by describe_algorithm.",
                },
                "output_name": {
                    "type": "string",
                    "description": "Name for the main output layer when it is added to the project.",
                },
                "load_outputs": {
                    "type": "boolean",
                    "description": "Add output layers to the project (default true).",
                },
            },
            "required": ["algorithm", "parameters"],
            "additionalProperties": False,
        },
    },
    {
        "name": "render_map",
        "description": (
            "Render the map to a PNG image and return it so you can look at it. Defaults to all "
            "visible layers and their combined extent. Optionally saves the PNG to a path."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "layers": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Layer names or ids to draw, top first. Default: visible layers.",
                },
                "extent": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "[xmin, ymin, xmax, ymax] in the project CRS. Default: extent of the drawn layers.",
                },
                "zoom_to_layer": {"type": "string", "description": "Layer name or id to zoom to instead of an explicit extent."},
                "width": {"type": "integer", "description": "Image width in pixels (default 1000)."},
                "height": {"type": "integer", "description": "Image height in pixels (default 700)."},
                "path": {"type": "string", "description": "Optional file path to save the PNG."},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "save_project",
        "description": "Save the QGIS project to its current file, or to the given .qgz path.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Target .qgz/.qgs path (optional)."}},
            "additionalProperties": False,
        },
    },
]

TOOLS_BY_NAME = {spec["name"]: spec for spec in TOOL_SPECS}

_JSON_TYPES = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "object": (dict,),
    "array": (list,),
}


def api_tool_definitions(eager_input_streaming: bool = True) -> List[Dict[str, Any]]:
    """Tool definitions as sent to the API. Order is stable so the prompt cache holds."""
    defs = []
    for spec in TOOL_SPECS:
        entry = {
            "name": spec["name"],
            "description": spec["description"],
            "input_schema": spec["input_schema"],
        }
        if eager_input_streaming:
            entry["eager_input_streaming"] = True
        defs.append(entry)
    return defs


def validate_input(name: str, tool_input: Any) -> Optional[str]:
    """Return an error message when ``tool_input`` does not match the tool schema, else None."""
    spec = TOOLS_BY_NAME.get(name)
    if spec is None:
        return f"Unknown tool '{name}'."
    if not isinstance(tool_input, dict):
        return "Tool input must be a JSON object."
    schema = spec["input_schema"]
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in tool_input:
            return f"Missing required parameter '{key}'."
    for key, value in tool_input.items():
        if key not in props:
            return f"Unexpected parameter '{key}'."
        expected = props[key].get("type")
        allowed = _JSON_TYPES.get(expected)
        if allowed is None or value is None:
            continue
        if expected in ("integer", "number") and isinstance(value, bool):
            return f"Parameter '{key}' must be a {expected}, got boolean."
        if not isinstance(value, allowed):
            return f"Parameter '{key}' must be of type {expected}."
        if expected == "array":
            item_type = props[key].get("items", {}).get("type")
            item_allowed = _JSON_TYPES.get(item_type)
            if item_allowed and any(
                (isinstance(v, bool) and item_type != "boolean") or not isinstance(v, item_allowed)
                for v in value
            ):
                return f"Items of '{key}' must be of type {item_type}."
    return None


@dataclass
class ToolResult:
    """Outcome of one tool call, convertible to a ``tool_result`` content block."""

    text: str = ""
    images: List[bytes] = field(default_factory=list)  # PNG bytes
    is_error: bool = False

    def truncated_text(self, limit: int = MAX_TOOL_OUTPUT_CHARS) -> str:
        if len(self.text) <= limit:
            return self.text
        head = self.text[: limit // 2]
        tail = self.text[-(limit // 4) :]
        dropped = len(self.text) - len(head) - len(tail)
        return f"{head}\n... [{dropped} characters truncated] ...\n{tail}"

    def to_block(self, tool_use_id: str) -> Dict[str, Any]:
        content: Any
        if self.images:
            content = [{"type": "text", "text": self.truncated_text() or "(no text output)"}]
            for png in self.images:
                content.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64.standard_b64encode(png).decode("ascii"),
                        },
                    }
                )
        else:
            content = self.truncated_text() or "(no output)"
        block: Dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
        if self.is_error:
            block["is_error"] = True
        return block

    # Wire format used by the bridge (JSON-safe).
    def to_json(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "images": [base64.standard_b64encode(png).decode("ascii") for png in self.images],
            "is_error": self.is_error,
        }

    @classmethod
    def from_json(cls, data: Dict[str, Any]) -> "ToolResult":
        return cls(
            text=str(data.get("text", "")),
            images=[base64.standard_b64decode(s) for s in data.get("images", [])],
            is_error=bool(data.get("is_error", False)),
        )


class ToolExecutor(Protocol):
    """Anything that can execute a named tool with validated input."""

    def execute(self, name: str, tool_input: Dict[str, Any]) -> ToolResult: ...


class LocalExecutor:
    """Executes tools against a ``QgisRuntime`` living in this process."""

    def __init__(self, runtime):
        self.runtime = runtime

    def execute(self, name: str, tool_input: Dict[str, Any]) -> ToolResult:
        handler = getattr(self, f"_tool_{name}", None)
        if handler is None:
            return ToolResult(text=f"Unknown tool '{name}'.", is_error=True)
        try:
            return handler(**tool_input)
        except Exception as exc:  # noqa: BLE001 - surfaced to the model as an error result
            return ToolResult(text=f"{type(exc).__name__}: {exc}", is_error=True)

    # -- handlers -----------------------------------------------------------------
    def _tool_run_pyqgis(self, code: str, purpose: Optional[str] = None) -> ToolResult:
        outcome = self.runtime.exec_code(code)
        parts = []
        if outcome.get("stdout"):
            parts.append(outcome["stdout"].rstrip())
        if outcome.get("result") is not None:
            parts.append(f"result = {outcome['result']}")
        if outcome.get("error"):
            parts.append(outcome["error"])
            return ToolResult(text="\n".join(parts), is_error=True)
        return ToolResult(text="\n".join(parts) or "OK (no output)")

    def _tool_project_summary(self) -> ToolResult:
        return ToolResult(text=self.runtime.project_summary())

    def _tool_list_layers(self) -> ToolResult:
        return ToolResult(text=self.runtime.list_layers())

    def _tool_describe_layer(self, layer: str, sample: int = 5) -> ToolResult:
        return ToolResult(text=self.runtime.describe_layer(layer, sample=sample))

    def _tool_load_layer(self, source: str, **kwargs) -> ToolResult:
        return ToolResult(text=self.runtime.load_layer(source, **kwargs))

    def _tool_search_algorithms(self, query: str, limit: int = 25) -> ToolResult:
        return ToolResult(text=self.runtime.search_algorithms(query, limit=limit))

    def _tool_describe_algorithm(self, algorithm: str) -> ToolResult:
        return ToolResult(text=self.runtime.describe_algorithm(algorithm))

    def _tool_run_algorithm(
        self,
        algorithm: str,
        parameters: Dict[str, Any],
        output_name: Optional[str] = None,
        load_outputs: bool = True,
    ) -> ToolResult:
        return ToolResult(
            text=self.runtime.run_algorithm(
                algorithm, parameters, output_name=output_name, load_outputs=load_outputs
            )
        )

    def _tool_render_map(self, **kwargs) -> ToolResult:
        text, png = self.runtime.render_map(**kwargs)
        return ToolResult(text=text, images=[png] if png else [])

    def _tool_save_project(self, path: Optional[str] = None) -> ToolResult:
        return ToolResult(text=self.runtime.save_project(path))


def describe_call(name: str, tool_input: Dict[str, Any], width: int = 100) -> str:
    """One-line human-readable description of a tool call for logs and the UI."""
    if name == "run_pyqgis":
        purpose = tool_input.get("purpose")
        if purpose:
            return f"run_pyqgis: {purpose}"
        first = (tool_input.get("code") or "").strip().splitlines()[:1]
        return f"run_pyqgis: {first[0] if first else ''}"[:width]
    try:
        args = json.dumps(tool_input, ensure_ascii=False)
    except (TypeError, ValueError):
        args = str(tool_input)
    if len(args) > width:
        args = args[: width - 3] + "..."
    return f"{name} {args}"
