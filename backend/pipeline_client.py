"""
Pipeline client — bridges InfraShield backend to the Polymath campus pipeline.

Imports the campus_pipeline directly (same Python environment).
If you run InfraShield and Polybrain as separate processes, swap the import
for an HTTP call to Polybrain's API.
"""
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

# Allow importing Polybrain integrations from the sibling project.
# Adjust this path if your directory layout differs.
POLYBRAIN_PATH = Path(__file__).parent.parent.parent / "Polybrain"
if str(POLYBRAIN_PATH) not in sys.path:
    sys.path.insert(0, str(POLYBRAIN_PATH))

try:
    from integrations.campus_pipeline import run_pipeline as _run_pipeline
    PIPELINE_AVAILABLE = True
except ImportError:
    PIPELINE_AVAILABLE = False


ProgressCallback = Callable[[dict], Awaitable[None]]


async def run_campus_pipeline(
    name: str,
    latitude: float,
    longitude: float,
    zone: str,
    facility_type: str,
    owner_type: str = "unknown",
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    """
    Run the Polymath campus pipeline for a given campus.
    Streams progress events via on_progress callback (for WebSocket relay).
    Returns a fully scored InfraShield facility dict.
    """
    if not PIPELINE_AVAILABLE:
        raise RuntimeError(
            "Polymath campus pipeline not available. "
            f"Ensure Polybrain is at {POLYBRAIN_PATH} and dependencies are installed."
        )

    return await _run_pipeline(
        name=name,
        latitude=latitude,
        longitude=longitude,
        zone=zone,
        facility_type=facility_type,
        owner_type=owner_type,
        on_progress=on_progress,
    )
