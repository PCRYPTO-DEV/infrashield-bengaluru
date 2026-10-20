"""Doctor Maps - a Claude-powered agent that builds anything inside QGIS.

The package serves three roles from one folder:

* ``python -m doctor_maps`` - a terminal agent that drives QGIS either headlessly
  (standalone QgsApplication) or through a running QGIS desktop (bridge mode).
* A QGIS plugin - copy or symlink this folder into the QGIS plugins directory and
  enable "Doctor Maps" to get a chat dock inside QGIS.
* A library - ``DoctorMapsAgent`` + ``QgisRuntime`` for your own scripts.

Keep this module import-light: QGIS loads it to discover the plugin, and the
Anthropic SDK may not be installed yet at that point.
"""

__version__ = "0.1.0"
__all__ = ["__version__", "classFactory"]


def classFactory(iface):  # noqa: N802 - name required by QGIS
    """QGIS plugin entry point."""
    from .plugin.plugin import DoctorMapsPlugin

    return DoctorMapsPlugin(iface)
