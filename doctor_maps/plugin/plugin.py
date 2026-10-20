"""QGIS plugin entry: toolbar action, dock, and the terminal bridge."""
from __future__ import annotations

from typing import Optional

from qgis.core import QgsSettings
from qgis.PyQt.QtCore import Qt, QTimer
from qgis.PyQt.QtWidgets import QAction

SETTINGS_KEY_BRIDGE = "doctor_maps/bridge_enabled"
MENU = "&Doctor Maps"


class DoctorMapsPlugin:
    def __init__(self, iface):
        self.iface = iface
        self.dock = None
        self.runtime = None
        self.invoker = None
        self.bridge = None
        self.actions = []

    # ----------------------------------------------------------- lifecycle
    def initGui(self) -> None:  # noqa: N802
        open_action = QAction("Doctor Maps", self.iface.mainWindow())
        open_action.setToolTip("Open the Doctor Maps agent dock")
        open_action.triggered.connect(self.show_dock)
        self.iface.addToolBarIcon(open_action)
        self.iface.addPluginToMenu(MENU, open_action)

        self.bridge_action = QAction("Allow terminal connections (bridge)", self.iface.mainWindow())
        self.bridge_action.setCheckable(True)
        self.bridge_action.setChecked(QgsSettings().value(SETTINGS_KEY_BRIDGE, True, type=bool))
        self.bridge_action.toggled.connect(self._toggle_bridge)
        self.iface.addPluginToMenu(MENU, self.bridge_action)
        self.actions = [open_action, self.bridge_action]

        # Processing and the rest of QGIS finish initialising after plugins load.
        QTimer.singleShot(1500, self._autostart_bridge)

    def unload(self) -> None:
        self._stop_bridge()
        for action in self.actions:
            self.iface.removePluginMenu(MENU, action)
        if self.actions:
            self.iface.removeToolBarIcon(self.actions[0])
        if self.dock is not None:
            self.iface.removeDockWidget(self.dock)
            self.dock.deleteLater()
            self.dock = None
        if self.runtime is not None:
            self.runtime.reset_namespace()
        self.runtime = None

    # ------------------------------------------------------------- helpers
    def _ensure_runtime(self):
        if self.runtime is None:
            from ..qgis_runtime import QgisRuntime
            from .worker import MainThreadInvoker

            self.runtime = QgisRuntime(iface=self.iface)
            self.invoker = MainThreadInvoker(self.iface.mainWindow())
        return self.runtime

    def show_dock(self) -> None:
        if self.dock is None:
            from .dock import DoctorMapsDock

            self._ensure_runtime()
            self.dock = DoctorMapsDock(self.iface, self.runtime, self.invoker, self.iface.mainWindow())
            self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dock)
        self.dock.show()
        self.dock.raise_()

    # -------------------------------------------------------------- bridge
    def _autostart_bridge(self) -> None:
        if self.bridge_action.isChecked():
            self._start_bridge()

    def _toggle_bridge(self, enabled: bool) -> None:
        QgsSettings().setValue(SETTINGS_KEY_BRIDGE, enabled)
        if enabled:
            self._start_bridge()
        else:
            self._stop_bridge()

    def _start_bridge(self) -> None:
        if self.bridge is not None:
            return
        try:
            from ..bridge import BridgeServer
            from ..tools import LocalExecutor
            from .worker import MainThreadExecutor

            self._ensure_runtime()
            executor = MainThreadExecutor(LocalExecutor(self.runtime), self.invoker)
            self.bridge = BridgeServer(executor).start()
            self.iface.messageBar().pushInfo("Doctor Maps", f"Terminal bridge listening on {self.bridge.url} (run `doctor-maps` in a terminal).")
        except Exception as exc:  # noqa: BLE001
            self.bridge = None
            self.iface.messageBar().pushWarning("Doctor Maps", f"Could not start the terminal bridge: {exc}")

    def _stop_bridge(self) -> None:
        if self.bridge is not None:
            try:
                self.bridge.stop()
            finally:
                self.bridge = None
