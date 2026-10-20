"""Runtime tests against a real headless QGIS. Skipped when PyQGIS is not importable
(run with the QGIS interpreter, e.g. /usr/bin/python3 -m pytest on Ubuntu)."""
from pathlib import Path

import pytest

qgis = pytest.importorskip("qgis.core")

from doctor_maps.qgis_runtime import QgisRuntime  # noqa: E402
from doctor_maps.tools import LocalExecutor  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "backend" / "data" / "bengaluru_facilities_seed.csv"
GEOJSON = ROOT / "backend" / "data" / "bengaluru_risk_zones_seed.geojson"


@pytest.fixture(scope="module")
def runtime(tmp_path_factory):
    rt = QgisRuntime.headless(output_dir=str(tmp_path_factory.mktemp("out")))
    yield rt
    rt.close()


@pytest.fixture(scope="module")
def executor(runtime):
    ex = LocalExecutor(runtime)
    assert not ex.execute("load_layer", {"source": str(CSV), "name": "facilities"}).is_error
    assert not ex.execute("load_layer", {"source": str(GEOJSON), "name": "risk_zones"}).is_error
    return ex


def test_csv_with_comment_lines_loads_as_points(executor):
    text = executor.execute("list_layers", {}).text
    assert "'facilities'" in text and "Point, 41 features" in text and "EPSG:4326" in text
    assert "'risk_zones'" in text and "Polygon, 8 features" in text


def test_project_adopts_first_layer_crs(runtime):
    assert runtime.project.crs().authid() == "EPSG:4326"
    assert "Project CRS: EPSG:4326" in runtime.project_summary()


def test_describe_layer_is_case_insensitive_and_lists_fields(executor):
    res = executor.execute("describe_layer", {"layer": "FACILITIES", "sample": 2})
    assert not res.is_error
    assert "criticality_score (integer)" in res.text
    assert "'name': 'Manipal Hospital Whitefield'" in res.text
    assert "'latitude': 12.9698" in res.text  # numbers stay numbers


def test_unknown_layer_lists_available_names(executor):
    res = executor.execute("describe_layer", {"layer": "nope"})
    assert res.is_error and "facilities" in res.text


def test_search_and_describe_algorithm(executor):
    found = executor.execute("search_algorithms", {"query": "buffer", "limit": 5}).text
    assert "native:buffer" in found
    desc = executor.execute("describe_algorithm", {"algorithm": "native:buffer"}).text
    assert "DISTANCE (distance)" in desc and "OUTPUT (sink)" in desc and "END_CAP_STYLE (enum)" in desc
    assert "No algorithm" in executor.execute("describe_algorithm", {"algorithm": "native:doesnotexist"}).text


def test_run_algorithm_resolves_layers_and_loads_outputs(executor, runtime):
    res = executor.execute(
        "run_algorithm",
        {"algorithm": "native:reprojectlayer", "parameters": {"INPUT": "facilities", "TARGET_CRS": "EPSG:32643"}, "output_name": "facilities_utm"},
    )
    assert not res.is_error, res.text
    assert "added layer 'facilities_utm'" in res.text and "EPSG:32643" in res.text
    res = executor.execute(
        "run_algorithm",
        {"algorithm": "native:buffer", "parameters": {"INPUT": "facilities_utm", "DISTANCE": 500}, "output_name": "buffers_500m"},
    )
    assert not res.is_error, res.text
    buffers = runtime.find_layer("buffers_500m")
    assert buffers.featureCount() == 41 and buffers.geometryType() == qgis.QgsWkbTypes.PolygonGeometry


def test_run_algorithm_without_loading(executor, runtime):
    before = len(runtime.project.mapLayers())
    res = executor.execute(
        "run_algorithm",
        {"algorithm": "native:centroids", "parameters": {"INPUT": "risk_zones"}, "load_outputs": False},
    )
    assert not res.is_error and "not added" in res.text
    assert len(runtime.project.mapLayers()) == before


def test_run_algorithm_errors_are_reported(executor):
    res = executor.execute("run_algorithm", {"algorithm": "native:buffer", "parameters": {"INPUT": "missing_layer"}})
    assert res.is_error


def test_run_pyqgis_persists_namespace_and_returns_result(executor):
    first = executor.execute("run_pyqgis", {"code": "lyr = project.mapLayersByName('facilities')[0]\nprint('count', lyr.featureCount())"})
    assert not first.is_error and "count 41" in first.text
    second = executor.execute("run_pyqgis", {"code": "result = sorted({f['facility_type'] for f in lyr.getFeatures()})[:2]"})
    assert not second.is_error and second.text.startswith("result = [")
    assert executor.execute("run_pyqgis", {"code": "result = iface"}).text == "OK (no output)"  # headless: iface is None


def test_run_pyqgis_reports_tracebacks(executor):
    res = executor.execute("run_pyqgis", {"code": "x = 1\ny = x / 0"})
    assert res.is_error
    assert "ZeroDivisionError" in res.text and 'File "<doctor_maps>", line 2' in res.text


def test_run_pyqgis_can_style_layers(executor, runtime):
    code = (
        "lyr = project.mapLayersByName('buffers_500m')[0]\n"
        "lyr.renderer().symbol().setColor(QColor('#e63946'))\n"
        "result = lyr.renderer().symbol().color().name()"
    )
    res = executor.execute("run_pyqgis", {"code": code})
    assert res.text == "result = #e63946"


def test_render_map_returns_png(executor, runtime):
    path = Path(runtime.output_dir) / "map.png"
    res = executor.execute("render_map", {"width": 320, "height": 200, "path": str(path)})
    assert not res.is_error, res.text
    assert len(res.images) == 1 and res.images[0][:8] == b"\x89PNG\r\n\x1a\n"
    assert path.exists() and path.stat().st_size == len(res.images[0])
    assert "320x200" in res.text and "EPSG:4326" in res.text

    subset = executor.execute("render_map", {"layers": ["risk_zones"], "zoom_to_layer": "risk_zones", "width": 100, "height": 100})
    assert not subset.is_error and "'risk_zones'" in subset.text and "'facilities'" not in subset.text


def test_render_map_rejects_bad_extent(executor):
    assert executor.execute("render_map", {"extent": [1, 2]}).is_error


def test_print_layout_export(executor, runtime):
    pdf = Path(runtime.output_dir) / "map.pdf"
    code = f"""
layout = QgsPrintLayout(project); layout.initializeDefaults(); layout.setName('Test'); project.layoutManager().addLayout(layout)
m = QgsLayoutItemMap(layout); m.attemptSetSceneRect(QRectF(10, 10, 277, 180)); m.setExtent(project.mapLayersByName('facilities')[0].extent()); layout.addLayoutItem(m)
result = QgsLayoutExporter(layout).exportToPdf(r'{pdf}', QgsLayoutExporter.PdfExportSettings())
"""
    res = executor.execute("run_pyqgis", {"code": code})
    assert res.text == "result = 0" and pdf.exists()
    assert "Print layouts: Test" in runtime.project_summary()


def test_save_and_reopen_project(executor, runtime):
    target = Path(runtime.output_dir) / "test.qgz"
    res = executor.execute("save_project", {"path": str(target)})
    assert not res.is_error and target.exists()
    assert "temporary (memory) layer" in res.text and "'buffers_500m'" in res.text
    n_layers = len(runtime.project.mapLayers())
    assert "layer(s)" in runtime.open_project(str(target))
    assert len(runtime.project.mapLayers()) == n_layers


def test_load_layer_missing_file(executor):
    res = executor.execute("load_layer", {"source": "/nonexistent/file.shp"})
    assert res.is_error and "No such file" in res.text


def test_load_csv_without_coordinates_is_a_table(executor, runtime, tmp_path):
    csv = tmp_path / "table.csv"
    csv.write_text("id,label\n1,a\n2,b\n")
    res = executor.execute("load_layer", {"source": str(csv), "name": "plain_table"})
    assert not res.is_error and "NoGeometry, 2 features" in res.text


def test_main_thread_invoker_runs_callables_on_main_thread():
    from qgis.PyQt.QtCore import QCoreApplication, QThread

    from doctor_maps.plugin.worker import MainThreadInvoker

    app = QCoreApplication.instance()
    assert app is not None  # the headless QgsApplication from the fixture
    invoker = MainThreadInvoker()
    assert invoker.invoke(lambda: 41 + 1) == 42  # direct call on the main thread

    outcome = {}

    class Worker(QThread):
        def run(self):
            outcome["same_thread"] = invoker.invoke(lambda: QThread.currentThread() is app.thread())
            try:
                invoker.invoke(lambda: 1 / 0)
            except ZeroDivisionError:
                outcome["raised"] = True

    worker = Worker()
    worker.finished.connect(app.quit)
    worker.start()
    app.exec_()
    worker.wait()
    assert outcome == {"same_thread": True, "raised": True}


def test_end_to_end_agent_loop_against_real_qgis(runtime, executor):
    """The full chain: scripted Claude turns -> agent loop -> LocalExecutor -> QGIS -> results/images back."""
    from doctor_maps.agent import AgentConfig, DoctorMapsAgent
    from tests.test_doctor_maps_agent import FakeClient, message, text_block, tool_block

    names = {l.name() for l in runtime.project.mapLayers().values()}
    for name, source in (("facilities", CSV), ("risk_zones", GEOJSON)):
        if name not in names:
            assert not executor.execute("load_layer", {"source": str(source), "name": name}).is_error
    utm = next((l for l in runtime.project.mapLayers().values() if l.name() == "facilities_utm"), None)
    if utm is not None and utm.featureCount() == 0:  # memory layer emptied by a project reopen
        runtime.project.removeMapLayer(utm.id())
        utm = None
    if utm is None:
        res = executor.execute("run_algorithm", {"algorithm": "native:reprojectlayer", "parameters": {"INPUT": "facilities", "TARGET_CRS": "EPSG:32643"}, "output_name": "facilities_utm"})
        assert not res.is_error, res.text

    style_code = (
        "lyr = project.mapLayersByName('risk_zones')[0]\n"
        "cats = [QgsRendererCategory(v, QgsSymbol.defaultSymbol(lyr.geometryType()), v) for v in ('High', 'Medium', 'Low')]\n"
        "lyr.setRenderer(QgsCategorizedSymbolRenderer('severity', cats)); lyr.triggerRepaint()\n"
        "result = lyr.renderer().type()"
    )
    client = FakeClient([
        message([text_block("Checking the project."), tool_block("list_layers", {}, "a")], stop_reason="tool_use"),
        message([tool_block("run_algorithm", {"algorithm": "native:buffer", "parameters": {"INPUT": "facilities_utm", "DISTANCE": 1000}, "output_name": "buffers_1km"}, "b")], stop_reason="tool_use"),
        message([tool_block("run_pyqgis", {"code": style_code, "purpose": "categorise zones by severity"}, "c"),
                 tool_block("render_map", {"layers": ["buffers_1km", "risk_zones"], "width": 240, "height": 160}, "d")], stop_reason="tool_use"),
        message([text_block("Built 1 km buffers and styled the zones.")]),
    ])
    events = []
    agent = DoctorMapsAgent(LocalExecutor(runtime), client=client, config=AgentConfig(), on_event=events.append)
    answer = agent.ask("buffer the facilities by 1 km and colour the risk zones by severity", context=runtime.project_summary())

    assert answer == "Built 1 km buffers and styled the zones."
    results = {b["tool_use_id"]: b for m in agent.messages if m["role"] == "user" and isinstance(m["content"], list) for b in m["content"] if isinstance(b, dict) and b.get("type") == "tool_result"}
    assert set(results) == {"a", "b", "c", "d"}
    assert not any(r.get("is_error") for r in results.values()), results
    assert runtime.find_layer("buffers_1km").featureCount() == 41
    assert runtime.find_layer("risk_zones").renderer().type() == "categorizedSymbol"
    assert results["c"]["content"] == "result = categorizedSymbol"
    assert results["d"]["content"][1]["type"] == "image"  # Claude gets to see the map
    assert [e.kind for e in events].count("tool_call") == 4


def test_render_map_handles_empty_layers(executor, runtime):
    empty = qgis.QgsVectorLayer("Point?crs=EPSG:4326", "empty_points", "memory")
    runtime.project.addMapLayer(empty)
    try:
        res = executor.execute("render_map", {"layers": ["empty_points"], "width": 64, "height": 64})
        assert res.is_error and "no extent" in res.text
        res = executor.execute("render_map", {"layers": ["empty_points", "risk_zones"], "width": 64, "height": 64})
        assert not res.is_error and res.images
    finally:
        runtime.project.removeMapLayer(empty.id())
