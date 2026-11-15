#!/usr/bin/env python3
"""Make MiroFish ready: install it if needed, configure it, start the backend.

Safe to run every time. If the backend already answers, it does nothing.

    python scripts/setup.py              # install + configure + start
    python scripts/setup.py --stop       # stop the backend this script started
    python scripts/setup.py --reconfigure  # rewrite .env from the options below

Configuration (environment variables, all optional):
    MIROFISH_HOME        where MiroFish lives (default ~/.mirofish)
    MIROFISH_URL         backend URL to check (default http://localhost:5001)
    MIROFISH_LLM_BASE_URL  OpenAI-compatible endpoint (default: Google Gemini)
    MIROFISH_LLM_MODEL   model name (default gemini-3.5-flash)
    MIROFISH_LLM_KEY     LLM key (default "proxy-injected": in a Claude cloud
                         session the network proxy fills in the saved key)
    MIROFISH_ZEP_KEY     Zep key (default "proxy-injected", same idea)
On your own computer, put real keys in MIROFISH_LLM_KEY / MIROFISH_ZEP_KEY.
"""

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "https://github.com/666ghj/MiroFish"
# The commit this skill's client and API reference were written against.
PINNED_COMMIT = "7657031ac01184afe2cb220f5ee3545573b5e843"

HOME = Path(os.environ.get("MIROFISH_HOME", Path.home() / ".mirofish"))
SRC = HOME / "MiroFish"
BACKEND = SRC / "backend"
PID_FILE = HOME / "backend.pid"
LOG_FILE = HOME / "backend.log"
URL = os.environ.get("MIROFISH_URL", "http://localhost:5001").rstrip("/")


def log(msg):
    print(msg, flush=True)


def run(cmd, cwd=None, env=None):
    log("  $ " + " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def backend_up():
    try:
        with urllib.request.urlopen(URL + "/api/simulation/list", timeout=5) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def ensure_source():
    if (BACKEND / "run.py").exists():
        return
    log(f"Downloading MiroFish ({PINNED_COMMIT[:7]}) to {SRC} ...")
    SRC.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q"], cwd=SRC)
    run(["git", "remote", "add", "origin", REPO], cwd=SRC)
    run(["git", "fetch", "-q", "--depth", "1", "origin", PINNED_COMMIT], cwd=SRC)
    run(["git", "checkout", "-q", "FETCH_HEAD"], cwd=SRC)


def patch_zep_timeout():
    """Make MiroFish's hard-coded 600s Zep ingestion wait configurable.

    Zep's free tier can take longer than 10 minutes to ingest long documents.
    The wait then reads MIROFISH_ZEP_TIMEOUT from the backend's environment
    (default 3600 seconds). Returns True if the file was changed.
    """
    path = BACKEND / "app" / "utils" / "zep.py"
    old = "ZEP_INGESTION_WAIT_TIMEOUT_SECONDS = 600\n"
    new = 'ZEP_INGESTION_WAIT_TIMEOUT_SECONDS = int(os.environ.get("MIROFISH_ZEP_TIMEOUT", "3600"))\n'
    text = path.read_text()
    if new in text:
        return False
    if old not in text:
        log("warning: could not find MiroFish's Zep timeout to raise; long documents may time out")
        return False
    path.write_text(text.replace(old, new))
    log("Raised MiroFish's Zep ingestion wait to MIROFISH_ZEP_TIMEOUT (default 3600s)")
    return True


def ensure_deps():
    if (BACKEND / ".venv" / "bin" / "python").exists():
        return
    if not shutil.which("uv"):
        sys.exit("error: 'uv' is not installed. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh")
    log("Installing MiroFish's Python dependencies (first run takes a few minutes) ...")
    env = dict(os.environ, UV_PYTHON=os.environ.get("UV_PYTHON", "3.12"))
    run(["uv", "sync", "--quiet"], cwd=BACKEND, env=env)


def ensure_env(reconfigure):
    env_file = SRC / ".env"
    if env_file.exists() and not reconfigure:
        return
    values = {
        "LLM_API_KEY": os.environ.get("MIROFISH_LLM_KEY", "proxy-injected"),
        "LLM_BASE_URL": os.environ.get(
            "MIROFISH_LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"
        ),
        "LLM_MODEL_NAME": os.environ.get("MIROFISH_LLM_MODEL", "gemini-3.5-flash"),
        "ZEP_API_KEY": os.environ.get("MIROFISH_ZEP_KEY", "proxy-injected"),
    }
    env_file.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
    env_file.chmod(0o600)
    log(f"Wrote {env_file} (model {values['LLM_MODEL_NAME']})")


def start_backend():
    log(f"Starting the MiroFish backend (log: {LOG_FILE}) ...")
    with open(LOG_FILE, "ab") as out:
        proc = subprocess.Popen(
            [str(BACKEND / ".venv" / "bin" / "python"), "run.py"],
            cwd=BACKEND,
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    PID_FILE.write_text(str(proc.pid))
    for _ in range(60):
        if backend_up():
            return
        if proc.poll() is not None:
            tail = LOG_FILE.read_text(errors="replace")[-1500:]
            sys.exit(f"error: backend exited (code {proc.returncode}). Last log lines:\n{tail}")
        time.sleep(2)
    sys.exit(f"error: backend did not answer at {URL} within 2 minutes; see {LOG_FILE}")


def stop_backend():
    if not PID_FILE.exists():
        log("No backend started by this script.")
        return
    pid = int(PID_FILE.read_text())
    PID_FILE.unlink()
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        log("Backend was not running.")
        return
    # Flask's dev server can ignore SIGTERM while worker threads are busy.
    for _ in range(20):
        time.sleep(0.5)
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            log(f"Stopped backend (pid {pid}).")
            return
    os.killpg(pid, signal.SIGKILL)
    log(f"Stopped backend (pid {pid}, forced).")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--stop", action="store_true", help="stop the backend this script started")
    p.add_argument("--reconfigure", action="store_true", help="rewrite .env and restart")
    args = p.parse_args()

    if args.stop:
        stop_backend()
        return
    patched = (BACKEND / "run.py").exists() and patch_zep_timeout()
    if backend_up() and not args.reconfigure and not patched:
        log(f"MiroFish is ready at {URL}")
        return
    HOME.mkdir(parents=True, exist_ok=True)
    ensure_source()
    patched = patch_zep_timeout() or patched
    ensure_deps()
    ensure_env(args.reconfigure)
    if args.reconfigure or patched:
        stop_backend()
    start_backend()
    log(f"MiroFish is ready at {URL}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"error: command failed ({e.returncode}): {' '.join(e.cmd)}")
