"""The Doctor Maps chat dock inside QGIS."""
from __future__ import annotations

import html
import os
import subprocess
import sys
import uuid
from typing import Any, Dict, Optional

from qgis.core import QgsSettings
from qgis.PyQt.QtCore import Qt, QUrl
from qgis.PyQt.QtGui import QFont, QImage, QTextCursor, QTextDocument
from qgis.PyQt.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDockWidget,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

from ..agent import AgentConfig, AgentEvent, DoctorMapsAgent
from ..tools import LocalExecutor
from .worker import AgentWorker, MainThreadExecutor, MainThreadInvoker

SETTINGS_KEY_API = "doctor_maps/api_key"
SETTINGS_KEY_MODEL = "doctor_maps/model"
SETTINGS_KEY_EFFORT = "doctor_maps/effort"
SETTINGS_KEY_CONFIRM = "doctor_maps/confirm_code"
MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
EFFORTS = ["low", "medium", "high", "xhigh", "max"]


def sdk_available() -> bool:
    try:
        import anthropic  # noqa: F401

        return True
    except ImportError:
        return False


def install_sdk() -> str:
    """Best-effort ``pip install anthropic`` with the interpreter QGIS is using."""
    candidates = []
    exe = sys.executable or ""
    if os.path.basename(exe).lower().startswith("python"):
        candidates.append(exe)
    if sys.platform.startswith("win"):
        root = os.environ.get("OSGEO4W_ROOT", "")
        apps = os.path.join(root, "apps")
        if os.path.isdir(apps):
            for entry in sorted(os.listdir(apps), reverse=True):
                if entry.lower().startswith("python"):
                    candidates.append(os.path.join(apps, entry, "python.exe"))
    else:
        candidates += [os.path.join(sys.prefix, "bin", "python3"), "python3"]
    errors = []
    for python in candidates:
        try:
            proc = subprocess.run([python, "-m", "pip", "install", "--user", "anthropic"], capture_output=True, text=True, timeout=600)
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"{python}: {exc}")
            continue
        if proc.returncode == 0:
            return f"Installed with {python}. Restart QGIS to load it."
        errors.append(f"{python}: {proc.stderr[-400:]}")
    return "Automatic install failed. Run `python -m pip install anthropic` in the OSGeo4W Shell (Windows) or with the QGIS Python (macOS/Linux).\n" + "\n".join(errors)


class ApiKeyDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Anthropic API key")
        layout = QFormLayout(self)
        self.key = QLineEdit(self)
        self.key.setEchoMode(QLineEdit.Password)
        self.key.setPlaceholderText("sk-ant-...")
        self.remember = QCheckBox("Remember in QGIS settings (stored unencrypted)", self)
        layout.addRow("API key", self.key)
        layout.addRow(self.remember)
        layout.addRow(QLabel("Leave empty to use ANTHROPIC_API_KEY or an `ant auth login` profile."))
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel, self)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addRow(buttons)


class DoctorMapsDock(QDockWidget):
    def __init__(self, iface, runtime, invoker: MainThreadInvoker, parent=None):
        super().__init__("Doctor Maps", parent)
        self.setObjectName("DoctorMapsDock")
        self.iface = iface
        self.runtime = runtime
        self.invoker = invoker
        self.executor = MainThreadExecutor(LocalExecutor(runtime), invoker)
        self.agent: Optional[DoctorMapsAgent] = None
        self.worker: Optional[AgentWorker] = None
        self._api_key: Optional[str] = None
        self._confirm_enabled = False  # snapshot of the checkbox, read from the worker thread
        self._stream_open = False
        self._build_ui()

    # ------------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        settings = QgsSettings()
        root = QWidget(self)
        layout = QVBoxLayout(root)

        top = QHBoxLayout()
        self.model_box = QComboBox(root)
        self.model_box.setEditable(True)
        self.model_box.addItems(MODELS)
        self.model_box.setCurrentText(settings.value(SETTINGS_KEY_MODEL, os.environ.get("DOCTOR_MAPS_MODEL", MODELS[0])))
        self.effort_box = QComboBox(root)
        self.effort_box.addItems(EFFORTS)
        self.effort_box.setCurrentText(settings.value(SETTINGS_KEY_EFFORT, "high"))
        top.addWidget(QLabel("Model"))
        top.addWidget(self.model_box, 1)
        top.addWidget(QLabel("Effort"))
        top.addWidget(self.effort_box)
        key_btn = QPushButton("API key...", root)
        key_btn.clicked.connect(self.prompt_api_key)
        top.addWidget(key_btn)
        layout.addLayout(top)

        opts = QHBoxLayout()
        self.confirm_box = QCheckBox("Confirm before running code", root)
        self.confirm_box.setChecked(settings.value(SETTINGS_KEY_CONFIRM, False, type=bool))
        self.thinking_box = QCheckBox("Show reasoning", root)
        reset_btn = QPushButton("New conversation", root)
        reset_btn.clicked.connect(self.reset_conversation)
        opts.addWidget(self.confirm_box)
        opts.addWidget(self.thinking_box)
        opts.addStretch(1)
        opts.addWidget(reset_btn)
        layout.addLayout(opts)

        self.transcript = QTextBrowser(root)
        self.transcript.setOpenExternalLinks(True)
        self.transcript.setFont(QFont("Sans", 10))
        layout.addWidget(self.transcript, 1)

        self.input = QPlainTextEdit(root)
        self.input.setPlaceholderText("Describe what to build, e.g. 'Load the facilities CSV, buffer hospitals by 1 km and style by criticality'. Ctrl+Enter to send.")
        self.input.setMaximumHeight(90)
        self.input.installEventFilter(self)
        layout.addWidget(self.input)

        buttons = QHBoxLayout()
        self.status = QLabel("Ready", root)
        self.send_btn = QPushButton("Send", root)
        self.send_btn.clicked.connect(self.send)
        self.stop_btn = QPushButton("Stop", root)
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self.stop)
        buttons.addWidget(self.status, 1)
        buttons.addWidget(self.stop_btn)
        buttons.addWidget(self.send_btn)
        layout.addLayout(buttons)

        self.setWidget(root)
        if not sdk_available():
            self._offer_sdk_install()
        else:
            self._append_html("<p style='color:#666'>Doctor Maps ready. I can load data, run analysis, style layers, build layouts and export results in this QGIS session.</p>")

    def _offer_sdk_install(self) -> None:
        self._append_html(
            "<p style='color:#b00'>The Anthropic Python SDK is not installed in QGIS's Python. "
            "Run <code>python -m pip install anthropic</code> in the OSGeo4W Shell (Windows) or with the QGIS Python, then restart QGIS.</p>"
        )
        btn = QPushButton("Try to install it now", self.widget())
        btn.clicked.connect(lambda: QMessageBox.information(self, "Doctor Maps", install_sdk()))
        self.widget().layout().insertWidget(2, btn)
        self.send_btn.setEnabled(False)

    def eventFilter(self, obj, event):  # noqa: N802
        if obj is self.input and event.type() == event.KeyPress:
            if event.key() in (Qt.Key_Return, Qt.Key_Enter) and event.modifiers() & Qt.ControlModifier:
                self.send()
                return True
        return super().eventFilter(obj, event)

    # --------------------------------------------------------------- helpers
    def _append_html(self, fragment: str) -> None:
        self._stream_open = False
        self.transcript.moveCursor(QTextCursor.End)
        self.transcript.insertHtml(fragment)
        self.transcript.insertPlainText("\n")
        self.transcript.moveCursor(QTextCursor.End)

    def _append_stream(self, text: str) -> None:
        cursor = self.transcript.textCursor()
        cursor.movePosition(QTextCursor.End)
        if not self._stream_open:
            cursor.insertHtml("<br><b>Doctor Maps:</b> ")
            self._stream_open = True
        cursor.insertText(text)
        self.transcript.setTextCursor(cursor)
        self.transcript.ensureCursorVisible()

    def _append_image(self, png: bytes) -> None:
        image = QImage.fromData(png, "PNG")
        if image.isNull():
            return
        if image.width() > 640:
            image = image.scaledToWidth(640, Qt.SmoothTransformation)
        name = f"doctor_maps_{uuid.uuid4().hex}.png"
        self.transcript.document().addResource(QTextDocument.ImageResource, QUrl(name), image)
        self._append_html(f"<img src='{name}'>")

    def prompt_api_key(self) -> bool:
        dialog = ApiKeyDialog(self)
        if dialog.exec_() != QDialog.Accepted:
            return False
        key = dialog.key.text().strip()
        self._api_key = key or None
        settings = QgsSettings()
        if dialog.remember.isChecked() and key:
            settings.setValue(SETTINGS_KEY_API, key)
        elif not key:
            settings.remove(SETTINGS_KEY_API)
        self.agent = None  # rebuild the client with the new key
        return True

    def _resolve_api_key(self) -> Optional[str]:
        if self._api_key:
            return self._api_key
        stored = QgsSettings().value(SETTINGS_KEY_API, "")
        if stored:
            self._api_key = stored
            return stored
        return None  # SDK falls back to ANTHROPIC_API_KEY / ant profile

    def _ensure_agent(self) -> DoctorMapsAgent:
        import anthropic

        model = self.model_box.currentText().strip() or MODELS[0]
        effort = self.effort_box.currentText()
        settings = QgsSettings()
        settings.setValue(SETTINGS_KEY_MODEL, model)
        settings.setValue(SETTINGS_KEY_EFFORT, effort)
        settings.setValue(SETTINGS_KEY_CONFIRM, self.confirm_box.isChecked())
        if self.agent is None:
            key = self._resolve_api_key()
            client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
            config = AgentConfig(model=model, effort=effort, show_thinking=self.thinking_box.isChecked(), output_dir=self.runtime.output_dir)
            self.agent = DoctorMapsAgent(self.executor, client=client, config=config, confirm=self._confirm_tool)
        else:
            self.agent.config.model = model
            self.agent.config.effort = effort
            self.agent.config.show_thinking = self.thinking_box.isChecked()
        return self.agent

    def _confirm_tool(self, name: str, tool_input: Dict[str, Any]) -> bool:
        """Called on the worker thread; the dialog itself runs on the main thread."""
        if not self._confirm_enabled or name not in ("run_pyqgis", "run_algorithm"):
            return True
        return bool(self.invoker.invoke(lambda: self._confirm_dialog(name, tool_input)))

    def _confirm_dialog(self, name: str, tool_input: Dict[str, Any]) -> bool:
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Question)
        box.setWindowTitle("Doctor Maps wants to run a tool")
        if name == "run_pyqgis":
            box.setText(tool_input.get("purpose") or "Run this PyQGIS code?")
            box.setDetailedText(tool_input.get("code", ""))
        else:
            box.setText(f"Run {tool_input.get('algorithm')} with these parameters?")
            box.setDetailedText(repr(tool_input.get("parameters")))
        box.setStandardButtons(QMessageBox.Yes | QMessageBox.No)
        return box.exec_() == QMessageBox.Yes

    # --------------------------------------------------------------- actions
    def send(self) -> None:
        if self.worker is not None and self.worker.isRunning():
            return
        text = self.input.toPlainText().strip()
        if not text:
            return
        try:
            agent = self._ensure_agent()
        except Exception as exc:  # noqa: BLE001
            self._append_html(f"<p style='color:#b00'>{html.escape(str(exc))}</p>")
            return
        self.input.clear()
        self._confirm_enabled = self.confirm_box.isChecked()
        self._append_html(f"<br><b>You:</b> {html.escape(text)}")
        context = self.runtime.project_summary()
        self.worker = AgentWorker(agent, text, context, parent=self)
        self.worker.event.connect(self._on_event)
        self.worker.completed.connect(self._on_completed)
        self.worker.failed.connect(self._on_failed)
        self.worker.finished.connect(self._on_finished)
        self.send_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.status.setText("Working...")
        self.worker.start()

    def stop(self) -> None:
        if self.agent is not None:
            self.agent.stop()
            self.status.setText("Stopping after the current step...")

    def reset_conversation(self) -> None:
        if self.agent is not None:
            self.agent.reset()
        self._append_html("<p style='color:#666'>New conversation started.</p>")

    # ---------------------------------------------------------------- events
    def _on_event(self, event: AgentEvent) -> None:
        if event.kind == "text":
            self._append_stream(event.data)
        elif event.kind == "thinking":
            self._append_html(f"<span style='color:#888;font-style:italic'>{html.escape(event.data)}</span>")
        elif event.kind == "tool_call":
            self._append_html(f"<span style='color:#1a6'>&#9881; {html.escape(event.data['summary'])}</span>")
            self.status.setText(event.data["summary"][:80])
        elif event.kind == "tool_result":
            text = (event.data["text"] or "").strip()
            first = text.splitlines()[0] if text else "(no output)"
            colour = "#b00" if event.data["is_error"] else "#777"
            self._append_html(f"<span style='color:{colour}'>&nbsp;&nbsp;{html.escape(first[:200])}</span>")
            for png in event.data.get("images", []):
                self._append_image(png)
            self.iface.mapCanvas().refresh()
        elif event.kind == "status":
            self.status.setText(str(event.data))
        elif event.kind == "error":
            self._append_html(f"<span style='color:#b00'>{html.escape(str(event.data))}</span>")
        elif event.kind == "usage":
            u = event.data
            self.status.setToolTip(f"tokens in={u['input_tokens']} out={u['output_tokens']} cached={u['cache_read_input_tokens']}")

    def _on_completed(self, answer: str) -> None:
        self._stream_open = False
        self.transcript.insertPlainText("\n")

    def _on_failed(self, message: str) -> None:
        self._append_html(f"<p style='color:#b00'>{html.escape(message)}</p>")
        if "Authentication" in message:
            self.prompt_api_key()

    def _on_finished(self) -> None:
        self.send_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.status.setText("Ready")
        self.iface.mapCanvas().refresh()
        self.worker = None
