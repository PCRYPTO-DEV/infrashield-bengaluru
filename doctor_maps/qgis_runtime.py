"""Everything that touches PyQGIS lives here.

``QgisRuntime`` wraps a live QGIS environment - either the desktop application
(constructed with ``iface``) or a standalone ``QgsApplication`` started by
``QgisRuntime.headless()``. Every tool Claude can call is a method on it; the
``run_pyqgis`` tool is ``exec_code`` with a persistent namespace.

All methods return plain text (and PNG bytes for ``render_map``) so the same
code serves the in-process executor and the JSON bridge.
"""
from __future__ import annotations

import contextlib
import io
import os
import platform
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

MAX_VALUE_CHARS = 4_000
_EXEC_FILENAME = "<doctor_maps>"

RASTER_EXTENSIONS = {
    ".tif", ".tiff", ".img", ".vrt", ".asc", ".jp2", ".nc", ".dem", ".hgt", ".bil", ".ecw", ".sid", ".png", ".jpg",
}
TABLE_EXTENSIONS = {".csv", ".tsv", ".txt"}
LON_NAMES = ("longitude", "lon", "lng", "long", "x", "easting")
LAT_NAMES = ("latitude", "lat", "y", "northing")


def guess_prefix_path() -> Optional[str]:
    """Best-effort QGIS install prefix for standalone use."""
    env = os.environ.get("QGIS_PREFIX_PATH")
    if env:
        return env
    system = platform.system()
    if system == "Windows":
        root = os.environ.get("OSGEO4W_ROOT")
        if root:
            return os.path.join(root, "apps", "qgis")
    elif system == "Darwin":
        for candidate in ("/Applications/QGIS.app/Contents/MacOS", "/Applications/QGIS-LTR.app/Contents/MacOS"):
            if os.path.isdir(candidate):
                return candidate
    else:
        for candidate in ("/usr", "/usr/local"):
            if os.path.isdir(os.path.join(candidate, "share", "qgis")):
                return candidate
    return None


class QgisRuntime:
    """A live QGIS session that tools operate on."""

    def __init__(self, iface=None, app=None, output_dir: Optional[str] = None):
        from qgis.core import QgsProject

        self.iface = iface
        self.app = app
        self.output_dir = output_dir
        self._ns: Optional[Dict[str, Any]] = None
        self._project_cls = QgsProject
        self._ensure_processing()

    # ------------------------------------------------------------------ setup
    @classmethod
    def headless(cls, prefix_path: Optional[str] = None, output_dir: Optional[str] = None) -> "QgisRuntime":
        """Start a standalone QgsApplication (no desktop needed) and wrap it."""
        if not os.environ.get("DISPLAY") and platform.system() == "Linux":
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from qgis.core import QgsApplication

        prefix = prefix_path or guess_prefix_path()
        if prefix:
            QgsApplication.setPrefixPath(prefix, True)
        app = QgsApplication([], True)
        app.initQgis()
        return cls(iface=None, app=app, output_dir=output_dir)

    def _ensure_processing(self) -> None:
        from qgis.core import QgsApplication

        try:
            import processing  # noqa: F401
        except ImportError:
            plugins_dir = os.path.join(QgsApplication.pkgDataPath(), "python", "plugins")
            if plugins_dir not in sys.path:
                sys.path.append(plugins_dir)
            import processing  # noqa: F401

        registry = QgsApplication.processingRegistry()
        if registry.providerById("native") is None:
            from processing.core.Processing import Processing

            Processing.initialize()
        if registry.providerById("native") is None:
            from qgis.analysis import QgsNativeAlgorithms

            registry.addProvider(QgsNativeAlgorithms())

    def close(self) -> None:
        if self.app is not None:
            self.app.exitQgis()
            self.app = None

    # --------------------------------------------------------------- helpers
    @property
    def project(self):
        return self._project_cls.instance()

    @property
    def is_gui(self) -> bool:
        return self.iface is not None

    def find_layer(self, ref: str):
        """Resolve a layer by id, exact name, or case-insensitive name."""
        if not ref:
            raise ValueError("Empty layer reference.")
        layers = self.project.mapLayers()
        if ref in layers:
            return layers[ref]
        by_name = self.project.mapLayersByName(ref)
        if by_name:
            return by_name[0]
        lowered = ref.lower()
        for layer in layers.values():
            if layer.name().lower() == lowered:
                return layer
        names = ", ".join(repr(l.name()) for l in layers.values()) or "(no layers)"
        raise ValueError(f"No layer named or with id {ref!r}. Layers: {names}")

    def _add_to_project(self, layer) -> None:
        """Add a layer and, like desktop QGIS, adopt its CRS when the project has none."""
        if not self.project.crs().isValid() and layer.crs().isValid():
            self.project.setCrs(layer.crs())
        self.project.addMapLayer(layer)

    def _layer_kind(self, layer) -> str:
        from qgis.core import QgsRasterLayer, QgsVectorLayer

        if isinstance(layer, QgsVectorLayer):
            return "vector"
        if isinstance(layer, QgsRasterLayer):
            return "raster"
        return type(layer).__name__.replace("Qgs", "").replace("Layer", "").lower() or "layer"

    def _geometry_name(self, layer) -> str:
        from qgis.core import QgsVectorLayer, QgsWkbTypes

        if isinstance(layer, QgsVectorLayer):
            return QgsWkbTypes.displayString(layer.wkbType()) or "NoGeometry"
        return "-"

    def _is_visible(self, layer) -> bool:
        node = self.project.layerTreeRoot().findLayer(layer.id())
        return bool(node and node.isVisible())

    def _layer_line(self, layer) -> str:
        kind = self._layer_kind(layer)
        parts = [f"- {layer.name()!r} (id={layer.id()}) {kind}"]
        if kind == "vector":
            parts.append(f"{self._geometry_name(layer)}, {layer.featureCount()} features")
        elif kind == "raster":
            parts.append(f"{layer.bandCount()} band(s), {layer.width()}x{layer.height()} px")
        parts.append(f"CRS={layer.crs().authid() or 'unknown'}")
        parts.append("visible" if self._is_visible(layer) else "hidden")
        return " | ".join(parts)

    @staticmethod
    def _short_source(source: str, limit: int = 160) -> str:
        return source if len(source) <= limit else source[: limit - 3] + "..."

    def _value_to_text(self, value: Any, limit: int = MAX_VALUE_CHARS) -> str:
        from qgis.core import QgsFeature, QgsGeometry, QgsMapLayer, QgsRectangle

        if isinstance(value, QgsMapLayer):
            text = self._layer_line(value)[2:]
        elif isinstance(value, QgsFeature):
            attrs = {f.name(): value[f.name()] for f in value.fields()} if value.fields().count() else value.attributes()
            geom = value.geometry().asWkt(6) if value.hasGeometry() else "no geometry"
            text = f"QgsFeature(id={value.id()}, attributes={attrs}, geometry={geom})"
        elif isinstance(value, QgsGeometry):
            text = value.asWkt(6)
        elif isinstance(value, QgsRectangle):
            text = value.toString(6)
        elif isinstance(value, (list, tuple, set)):
            inner = ", ".join(self._value_to_text(v, limit // 4) for v in list(value)[:50])
            text = f"[{inner}{', ...' if len(value) > 50 else ''}]"
        elif isinstance(value, dict):
            inner = ", ".join(f"{k!r}: {self._value_to_text(v, limit // 4)}" for k, v in list(value.items())[:50])
            text = "{" + inner + ("..." if len(value) > 50 else "") + "}"
        elif isinstance(value, str):
            text = value
        else:
            try:
                text = repr(value)
            except Exception:  # noqa: BLE001
                text = f"<{type(value).__name__}>"
        if len(text) > limit:
            text = text[:limit] + f"... [{len(text) - limit} more chars]"
        return text

    # ------------------------------------------------------------ run_pyqgis
    def namespace(self) -> Dict[str, Any]:
        """Persistent namespace for ``run_pyqgis``; rebuilt only on ``reset_namespace``."""
        if self._ns is None:
            ns: Dict[str, Any] = {"__name__": "__doctor_maps__"}
            exec(
                "from qgis.core import *\n"
                "from qgis.analysis import *\n"
                "from qgis.PyQt.QtCore import *\n"
                "from qgis.PyQt.QtGui import *\n"
                "import processing\n"
                "import os, sys, json, math, csv\n"
                "from pathlib import Path\n",
                ns,
            )
            try:
                exec("from qgis.gui import *\n", ns)
            except ImportError:
                pass
            ns["project"] = self.project
            ns["iface"] = self.iface
            ns["qgis_runtime"] = self
            self._ns = ns
        # Keep these fresh: the project instance can be replaced when a project is opened.
        self._ns["project"] = self.project
        self._ns["iface"] = self.iface
        return self._ns

    def reset_namespace(self) -> None:
        self._ns = None

    def exec_code(self, code: str) -> Dict[str, Any]:
        ns = self.namespace()
        ns["result"] = None
        out = io.StringIO()
        error = None
        try:
            compiled = compile(code, _EXEC_FILENAME, "exec")
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                exec(compiled, ns)
        except Exception:  # noqa: BLE001 - every error goes back to the model
            error = self._format_traceback()
        result = ns.get("result")
        return {
            "stdout": out.getvalue(),
            "result": None if result is None else self._value_to_text(result),
            "error": error,
        }

    def _attribute_value(self, value: Any) -> Any:
        if value is None or isinstance(value, (bool, int, float)):
            return value
        if isinstance(value, str):
            return value if len(value) <= 80 else value[:77] + "..."
        text = self._value_to_text(value, 80)
        return None if text == "NULL" else text

    @staticmethod
    def _format_traceback() -> str:
        lines = traceback.format_exc().splitlines()
        start = next((i for i, line in enumerate(lines) if _EXEC_FILENAME in line), None)
        if start is not None:
            lines = ["Traceback (most recent call last):"] + lines[start:]
        return "\n".join(lines)

    # -------------------------------------------------------------- inspect
    def qgis_version(self) -> str:
        from qgis.core import Qgis

        return Qgis.QGIS_VERSION

    def project_summary(self) -> str:
        project = self.project
        crs = project.crs()
        lines = [
            f"QGIS {self.qgis_version()} | mode: {'desktop (iface available)' if self.is_gui else 'headless (iface is None)'}",
            f"Project file: {project.fileName() or '(unsaved)'} | title: {project.title() or '-'}",
            f"Project CRS: {crs.authid() or 'not set'} {('(' + crs.description() + ')') if crs.isValid() else ''}".rstrip(),
            f"Home folder: {project.homePath() or os.getcwd()}",
            f"Output folder: {self.output_dir or project.homePath() or os.getcwd()}",
        ]
        layers = list(project.mapLayers().values())
        lines.append(f"Layers ({len(layers)}):")
        for layer in layers:
            lines.append(self._layer_line(layer))
        layouts = [lay.name() for lay in project.layoutManager().layouts()]
        lines.append(f"Print layouts: {', '.join(layouts) if layouts else '(none)'}")
        if self.is_gui:
            try:
                ext = self.iface.mapCanvas().extent()
                lines.append(f"Canvas extent: {ext.toString(6)}")
            except Exception:  # noqa: BLE001
                pass
        return "\n".join(lines)

    def list_layers(self) -> str:
        layers = list(self.project.mapLayers().values())
        if not layers:
            return "The project has no layers."
        lines = [f"{len(layers)} layer(s):"]
        for layer in layers:
            lines.append(self._layer_line(layer))
            lines.append(f"    source: {self._short_source(layer.source())}")
        return "\n".join(lines)

    def describe_layer(self, ref: str, sample: int = 5) -> str:
        from qgis.core import QgsFeatureRequest, QgsRasterBandStats, QgsVectorLayer

        layer = self.find_layer(ref)
        kind = self._layer_kind(layer)
        lines = [self._layer_line(layer)[2:], f"source: {self._short_source(layer.source(), 300)}"]
        extent = layer.extent()
        lines.append(f"extent: {extent.toString(6)}")
        if isinstance(layer, QgsVectorLayer):
            fields = layer.fields()
            lines.append(f"fields ({fields.count()}):")
            for f in fields:
                lines.append(f"  - {f.name()} ({f.typeName()})")
            renderer = layer.renderer()
            if renderer is not None:
                lines.append(f"renderer: {renderer.type()}")
            lines.append(f"labels: {'on' if layer.labelsEnabled() else 'off'}")
            if layer.selectedFeatureCount():
                lines.append(f"selected features: {layer.selectedFeatureCount()}")
            if sample and sample > 0:
                lines.append(f"sample features (first {sample}):")
                request = QgsFeatureRequest().setLimit(int(sample))
                for feat in layer.getFeatures(request):
                    attrs = {f.name(): self._attribute_value(feat[f.name()]) for f in fields}
                    geom = ""
                    if feat.hasGeometry():
                        wkt = feat.geometry().asWkt(5)
                        geom = f" geometry={wkt[:120]}{'...' if len(wkt) > 120 else ''}"
                    lines.append(f"  fid={feat.id()} {attrs}{geom}")
        elif kind == "raster":
            provider = layer.dataProvider()
            lines.append(f"size: {layer.width()} x {layer.height()} px, bands: {layer.bandCount()}")
            lines.append(f"pixel size: {layer.rasterUnitsPerPixelX():.6g} x {layer.rasterUnitsPerPixelY():.6g}")
            for band in range(1, min(layer.bandCount(), 4) + 1):
                try:
                    stats = provider.bandStatistics(band, QgsRasterBandStats.All, extent, 20_000)
                    lines.append(
                        f"band {band}: min={stats.minimumValue:.6g} max={stats.maximumValue:.6g} "
                        f"mean={stats.mean:.6g} stddev={stats.stdDev:.6g} nodata={provider.sourceNoDataValue(band)}"
                    )
                except Exception as exc:  # noqa: BLE001
                    lines.append(f"band {band}: statistics unavailable ({exc})")
            renderer = layer.renderer()
            if renderer is not None:
                lines.append(f"renderer: {renderer.type()}")
        return "\n".join(lines)

    # ----------------------------------------------------------- load_layer
    def load_layer(
        self,
        source: str,
        name: Optional[str] = None,
        provider: Optional[str] = None,
        x_field: Optional[str] = None,
        y_field: Optional[str] = None,
        crs: Optional[str] = None,
    ) -> str:
        from qgis.core import QgsRasterLayer, QgsVectorLayer

        src = source.strip()
        lowered = src.lower()
        path = Path(os.path.expanduser(src))
        ext = path.suffix.lower()
        if provider is None:
            if lowered.startswith("type=xyz") or ("url=" in lowered and "type=" in lowered):
                provider = "wms"
            elif lowered.startswith(("pg:", "dbname=", "service=")):
                provider = "postgres"
            elif lowered.startswith(("http://", "https://")) and "wfs" in lowered:
                provider = "wfs"
            elif ext in TABLE_EXTENSIONS or lowered.startswith("file://"):
                provider = "delimitedtext"
            elif ext in RASTER_EXTENSIONS:
                provider = "gdal"
            else:
                provider = "ogr"
        layer_name = name or (path.stem if path.suffix else "layer")

        if provider == "delimitedtext" and not lowered.startswith("file://"):
            if not path.exists():
                raise FileNotFoundError(f"No such file: {path}")
            src = self._delimitedtext_uri(path, x_field, y_field, crs)
        elif provider in ("ogr", "gdal") and not path.exists() and "|" not in src and not lowered.startswith("/vsi"):
            raise FileNotFoundError(f"No such file: {path}")

        if provider == "gdal":
            layer = QgsRasterLayer(src if path.suffix == "" else str(path), layer_name, "gdal")
        elif provider == "wms":
            layer = QgsRasterLayer(src, layer_name, "wms")
        else:
            layer = QgsVectorLayer(src, layer_name, provider)
        if not layer.isValid():
            detail = layer.error().message() if hasattr(layer, "error") else ""
            raise RuntimeError(f"Layer failed to load with provider '{provider}': {src}\n{detail}".rstrip())
        self._add_to_project(layer)
        return "Loaded " + self._layer_line(layer)[2:]

    @staticmethod
    def _delimitedtext_uri(path: Path, x_field: Optional[str], y_field: Optional[str], crs: Optional[str]) -> str:
        import csv

        skip = 0
        header: List[str] = []
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as fh:
            for line in fh:
                if line.startswith("#"):
                    skip += 1
                    continue
                header = next(csv.reader([line], delimiter=delimiter))
                break
        lowered = {h.strip().lower(): h.strip() for h in header}
        if x_field is None:
            x_field = next((lowered[n] for n in LON_NAMES if n in lowered), None)
        if y_field is None:
            y_field = next((lowered[n] for n in LAT_NAMES if n in lowered), None)
        params = [f"type=csv", f"delimiter={'%5Ct' if delimiter == chr(9) else ','}", "detectTypes=yes"]
        if skip:
            params.append(f"skipLines={skip}")
        if x_field and y_field:
            params += [f"xField={x_field}", f"yField={y_field}", f"crs={crs or 'EPSG:4326'}"]
        else:
            params.append("geomType=none")
        return f"file://{path.resolve()}?{'&'.join(params)}"

    # ------------------------------------------------------------ processing
    def _registry(self):
        from qgis.core import QgsApplication

        return QgsApplication.processingRegistry()

    def search_algorithms(self, query: str, limit: int = 25) -> str:
        tokens = [t for t in query.lower().replace(":", " ").split() if t]
        scored = []
        for alg in self._registry().algorithms():
            haystack = " ".join([alg.id(), alg.displayName(), alg.group() or "", " ".join(alg.tags())]).lower()
            score = sum(2 if t in alg.id().lower() or t in alg.displayName().lower() else (1 if t in haystack else 0) for t in tokens)
            if score:
                scored.append((-score, alg.id(), alg.displayName(), alg.group()))
        scored.sort()
        if not scored:
            return f"No algorithms match {query!r}."
        lines = [f"{min(len(scored), limit)} of {len(scored)} matches for {query!r}:"]
        for _, alg_id, display, group in scored[: max(1, int(limit))]:
            lines.append(f"- {alg_id}: {display} [{group}]")
        return "\n".join(lines)

    def _param_flags(self):
        from qgis.core import QgsProcessingParameterDefinition

        try:
            return QgsProcessingParameterDefinition.FlagOptional, QgsProcessingParameterDefinition.FlagHidden
        except AttributeError:  # QGIS >= 3.36 moved these to Qgis.ProcessingParameterFlag
            from qgis.core import Qgis

            return Qgis.ProcessingParameterFlag.Optional, Qgis.ProcessingParameterFlag.Hidden

    def describe_algorithm(self, algorithm: str) -> str:
        from qgis.core import QgsProcessingDestinationParameter, QgsProcessingParameterEnum

        alg = self._registry().algorithmById(algorithm)
        if alg is None:
            return f"No algorithm with id {algorithm!r}. Use search_algorithms to find the id."
        optional_flag, hidden_flag = self._param_flags()
        lines = [f"{alg.id()}: {alg.displayName()} [{alg.group()}]"]
        help_text = (alg.shortHelpString() or alg.shortDescription() or "").strip()
        if help_text:
            lines.append(help_text[:1500])
        lines.append("parameters:")
        for p in alg.parameterDefinitions():
            if bool(p.flags() & hidden_flag):
                continue
            optional = bool(p.flags() & optional_flag)
            default = p.defaultValue()
            entry = f"  - {p.name()} ({p.type()}{', optional' if optional else ''}): {p.description()}"
            if isinstance(p, QgsProcessingParameterEnum):
                opts = ", ".join(f"{i}={o}" for i, o in enumerate(p.options()))
                entry += f" | options: {opts}"
            if isinstance(p, QgsProcessingDestinationParameter):
                entry += " | output: file path, 'TEMPORARY_OUTPUT' or 'memory:name'"
            elif default not in (None, ""):
                entry += f" | default: {self._value_to_text(default, 120)}"
            lines.append(entry)
        outputs = alg.outputDefinitions()
        if outputs:
            lines.append("outputs:")
            for o in outputs:
                lines.append(f"  - {o.name()} ({o.type()}): {o.description()}")
        return "\n".join(lines)

    def _resolve_parameters(self, alg, parameters: Dict[str, Any]) -> Dict[str, Any]:
        from qgis.core import (
            QgsCoordinateReferenceSystem,
            QgsProcessing,
            QgsProcessingDestinationParameter,
            QgsProcessingParameterCrs,
            QgsProcessingParameterFeatureSource,
            QgsProcessingParameterMapLayer,
            QgsProcessingParameterMultipleLayers,
            QgsProcessingParameterRasterLayer,
            QgsProcessingParameterVectorLayer,
        )

        layer_types = (
            QgsProcessingParameterFeatureSource,
            QgsProcessingParameterMapLayer,
            QgsProcessingParameterRasterLayer,
            QgsProcessingParameterVectorLayer,
        )
        resolved = dict(parameters)

        def to_layer(value):
            if isinstance(value, str) and not os.path.exists(value):
                try:
                    return self.find_layer(value)
                except ValueError:
                    return value
            return value

        for p in alg.parameterDefinitions():
            name = p.name()
            if isinstance(p, QgsProcessingDestinationParameter):
                if name not in resolved and p.createByDefault():
                    resolved[name] = QgsProcessing.TEMPORARY_OUTPUT
            elif name in resolved:
                if isinstance(p, layer_types):
                    resolved[name] = to_layer(resolved[name])
                elif isinstance(p, QgsProcessingParameterMultipleLayers) and isinstance(resolved[name], list):
                    resolved[name] = [to_layer(v) for v in resolved[name]]
                elif isinstance(p, QgsProcessingParameterCrs) and isinstance(resolved[name], str):
                    crs = QgsCoordinateReferenceSystem(resolved[name])
                    if crs.isValid():
                        resolved[name] = crs
        return resolved

    def run_algorithm(
        self,
        algorithm: str,
        parameters: Dict[str, Any],
        output_name: Optional[str] = None,
        load_outputs: bool = True,
    ) -> str:
        import processing
        from qgis.core import (
            QgsMapLayer,
            QgsProcessingContext,
            QgsProcessingDestinationParameter,
            QgsProcessingFeedback,
            QgsProcessingUtils,
        )

        alg = self._registry().algorithmById(algorithm)
        if alg is None:
            raise ValueError(f"No algorithm with id {algorithm!r}. Use search_algorithms to find the id.")
        params = self._resolve_parameters(alg, parameters)

        log: List[str] = []

        class Feedback(QgsProcessingFeedback):
            def pushInfo(self, info):  # noqa: N802
                log.append(info)

            def pushConsoleInfo(self, info):  # noqa: N802
                log.append(info)

            def pushWarning(self, warning):  # noqa: N802
                log.append(f"WARNING: {warning}")

            def reportError(self, error, fatalError=False):  # noqa: N802,N803
                log.append(f"ERROR: {error}")

        context = QgsProcessingContext()
        context.setProject(self.project)
        feedback = Feedback()
        try:
            results = processing.run(alg.id(), params, context=context, feedback=feedback)
        except Exception as exc:  # noqa: BLE001
            tail = "\n".join(log[-15:])
            raise RuntimeError(f"{alg.id()} failed: {exc}\n{tail}".rstrip()) from exc

        destination_names = [p.name() for p in alg.parameterDefinitions() if isinstance(p, QgsProcessingDestinationParameter)]
        lines = [f"{alg.id()} finished."]
        first_output = True
        for key, value in results.items():
            if key in destination_names:
                layer = None
                if isinstance(value, QgsMapLayer):
                    layer = value
                elif isinstance(value, str):
                    layer = context.takeResultLayer(value)
                    if layer is None and value:
                        layer = QgsProcessingUtils.mapLayerFromString(value, context)
                        if layer is not None and layer.id() in context.temporaryLayerStore().mapLayers():
                            layer = context.takeResultLayer(layer.id())
                if layer is not None and layer.isValid():
                    if load_outputs:
                        if output_name and first_output:
                            layer.setName(output_name)
                        elif key != "OUTPUT":
                            layer.setName(f"{alg.displayName()} - {key}")
                        else:
                            layer.setName(f"{alg.displayName()}")
                        self._add_to_project(layer)
                        lines.append(f"{key}: added layer {self._layer_line(layer)[2:]}")
                    else:
                        lines.append(f"{key}: {self._layer_line(layer)[2:]} (not added to project)")
                    first_output = False
                    continue
            lines.append(f"{key}: {self._value_to_text(value, 300)}")
        if log:
            lines.append("log: " + " | ".join(log[-5:])[:600])
        return "\n".join(lines)

    # ------------------------------------------------------------- rendering
    def render_map(
        self,
        layers: Optional[List[str]] = None,
        extent: Optional[List[float]] = None,
        zoom_to_layer: Optional[str] = None,
        width: int = 1000,
        height: int = 700,
        path: Optional[str] = None,
        background: str = "#ffffff",
    ) -> Tuple[str, Optional[bytes]]:
        from qgis.core import (
            QgsCoordinateReferenceSystem,
            QgsCoordinateTransform,
            QgsMapRendererCustomPainterJob,
            QgsMapSettings,
            QgsRectangle,
        )
        from qgis.PyQt.QtCore import QBuffer, QIODevice, QSize
        from qgis.PyQt.QtGui import QColor, QImage, QPainter

        project = self.project
        if layers:
            draw = [self.find_layer(ref) for ref in layers]
        else:
            draw = [l for l in project.layerTreeRoot().layerOrder() if self._is_visible(l)]
        draw = [l for l in draw if l.isValid()]
        if not draw:
            return "Nothing to render: the project has no visible layers.", None

        dest_crs = project.crs()
        if not dest_crs.isValid():
            dest_crs = draw[0].crs() if draw[0].crs().isValid() else QgsCoordinateReferenceSystem("EPSG:4326")

        def layer_extent(layer) -> Optional[QgsRectangle]:
            rect = QgsRectangle(layer.extent())
            if rect.isNull():  # empty layer: nothing to frame
                return None
            if layer.crs().isValid() and layer.crs() != dest_crs:
                rect = QgsCoordinateTransform(layer.crs(), dest_crs, project).transformBoundingBox(rect)
            return rect

        if extent:
            if len(extent) != 4:
                raise ValueError("extent must be [xmin, ymin, xmax, ymax].")
            rect = QgsRectangle(*[float(v) for v in extent])
        elif zoom_to_layer:
            rect = layer_extent(self.find_layer(zoom_to_layer))
            if rect is None:
                raise ValueError(f"Layer {zoom_to_layer!r} is empty, so there is no extent to zoom to.")
        else:
            rect = None
            for layer in draw:
                r = layer_extent(layer)
                if r is None:
                    continue
                if rect is None:
                    rect = QgsRectangle(r)
                else:
                    rect.combineExtentWith(r)
            if rect is None:
                raise ValueError("None of the layers to draw has any features, so there is no extent to render.")
        if rect.width() == 0 or rect.height() == 0:
            cx, cy = rect.center().x(), rect.center().y()
            pad = 0.01 if dest_crs.isGeographic() else 500
            rect = QgsRectangle(cx - pad, cy - pad, cx + pad, cy + pad)
        rect.scale(1.08)

        width, height = max(64, int(width)), max(64, int(height))
        settings = QgsMapSettings()
        settings.setLayers(draw)
        settings.setDestinationCrs(dest_crs)
        settings.setTransformContext(project.transformContext())
        settings.setPathResolver(project.pathResolver())
        settings.setBackgroundColor(QColor(background))
        settings.setOutputSize(QSize(width, height))
        settings.setExtent(rect)

        image = QImage(QSize(width, height), QImage.Format_ARGB32_Premultiplied)
        image.fill(QColor(background))
        painter = QPainter(image)
        job = QgsMapRendererCustomPainterJob(settings, painter)
        job.start()
        job.waitForFinished()
        painter.end()

        buf = QBuffer()
        buf.open(QIODevice.WriteOnly)
        image.save(buf, "PNG")
        png = bytes(buf.data())
        buf.close()
        saved = ""
        if path:
            target = Path(os.path.expanduser(path))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(png)
            saved = f" Saved to {target}."
        names = ", ".join(repr(l.name()) for l in draw)
        return (
            f"Rendered {width}x{height} px, CRS {dest_crs.authid()}, extent {settings.extent().toString(6)}, "
            f"layers (top first): {names}.{saved}"
        ), png

    # --------------------------------------------------------------- project
    def save_project(self, path: Optional[str] = None) -> str:
        project = self.project
        target = path or project.fileName()
        if not target:
            raise ValueError("The project has never been saved; provide a path ending in .qgz.")
        target = os.path.expanduser(target)
        ok = project.write(target)
        if not ok:
            raise RuntimeError(f"QGIS refused to write the project to {target}: {project.error()}")
        temporary = [l.name() for l in project.mapLayers().values() if l.providerType() == "memory"]
        note = ""
        if temporary:
            note = (
                f"\nNote: {len(temporary)} temporary (memory) layer(s) are not stored in the project file and will be "
                f"empty when it is reopened: {', '.join(repr(n) for n in temporary)}. Export them to GeoPackage first if they matter."
            )
        return f"Project saved to {target}{note}"

    def open_project(self, path: str) -> str:
        target = os.path.expanduser(path)
        if not os.path.exists(target):
            raise FileNotFoundError(target)
        if self.is_gui:
            self.iface.addProject(target)
        else:
            if not self.project.read(target):
                raise RuntimeError(f"Could not read project {target}: {self.project.error()}")
        self.reset_namespace()
        return f"Opened project {target} with {len(self.project.mapLayers())} layer(s)."
