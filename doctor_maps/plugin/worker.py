"""Threading glue for the QGIS plugin.

QGIS objects must only be touched from the Qt main thread, while the Claude
API call must not block the GUI. So:

* ``AgentWorker`` (a QThread) runs ``DoctorMapsAgent.ask`` and re-emits agent
  events as Qt signals (queued to the main thread automatically).
* ``MainThreadInvoker`` runs any callable on the main thread and blocks the
  caller until it returns - used by ``MainThreadExecutor`` for tool calls and
  by the bridge server for calls arriving from the terminal.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from qgis.PyQt.QtCore import QCoreApplication, QObject, Qt, QThread, pyqtSignal, pyqtSlot

from ..agent import AgentEvent, DoctorMapsAgent, describe_api_error
from ..tools import ToolExecutor, ToolResult

_BLOCKING = getattr(Qt, "BlockingQueuedConnection", None) or Qt.ConnectionType.BlockingQueuedConnection


class _Request:
    __slots__ = ("fn", "result", "error")

    def __init__(self, fn: Callable[[], Any]):
        self.fn = fn
        self.result: Any = None
        self.error: Optional[BaseException] = None


class MainThreadInvoker(QObject):
    """Create this on the main thread; call ``invoke`` from any thread."""

    _call = pyqtSignal(object)

    def __init__(self, parent: Optional[QObject] = None):
        super().__init__(parent)
        self._call.connect(self._run, _BLOCKING)

    @pyqtSlot(object)
    def _run(self, request: _Request) -> None:
        try:
            request.result = request.fn()
        except BaseException as exc:  # noqa: BLE001 - re-raised on the calling thread
            request.error = exc

    def invoke(self, fn: Callable[[], Any]) -> Any:
        app = QCoreApplication.instance()
        if app is None or QThread.currentThread() is app.thread():
            return fn()
        request = _Request(fn)
        self._call.emit(request)  # blocks until the slot has run on the main thread
        if request.error is not None:
            raise request.error
        return request.result


class MainThreadExecutor:
    """``ToolExecutor`` that forwards to an in-process executor on the main thread."""

    def __init__(self, inner: ToolExecutor, invoker: MainThreadInvoker):
        self.inner = inner
        self.invoker = invoker

    def execute(self, name: str, tool_input: Dict[str, Any]) -> ToolResult:
        return self.invoker.invoke(lambda: self.inner.execute(name, tool_input))


class AgentWorker(QThread):
    event = pyqtSignal(object)  # AgentEvent
    completed = pyqtSignal(str)  # final answer
    failed = pyqtSignal(str)  # human-readable error

    def __init__(self, agent: DoctorMapsAgent, text: str, context: Optional[str], parent=None):
        super().__init__(parent)
        self.agent = agent
        self.text = text
        self.context = context

    def run(self) -> None:
        previous = self.agent.on_event
        self.agent.on_event = self._forward
        try:
            answer = self.agent.ask(self.text, context=self.context)
            self.completed.emit(answer)
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(describe_api_error(exc))
        finally:
            self.agent.on_event = previous

    def _forward(self, event: AgentEvent) -> None:
        self.event.emit(event)
