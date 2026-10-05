from __future__ import annotations

import argparse
import os
import signal
from pathlib import Path
from threading import Event

from .config import load_settings
from .control import ControlPlaneClient
from .providers import create_provider
from .runner import TtsRunner
from .storage import AudioStore


def main() -> None:
    parser = argparse.ArgumentParser(prog="ipresenterplux-tts")
    parser.add_argument("--once", action="store_true", help="Run one worker cycle and exit")
    args = parser.parse_args()

    settings = load_settings()
    control = ControlPlaneClient(settings)
    provider = create_provider(settings.provider)
    store = AudioStore(settings.storage_dir)
    status_path = Path(os.getenv("IPRESENTERPLUX_TTS_STATUS_PATH", "runtime/status.json"))
    runner = TtsRunner(settings, control, provider, store, status_path)

    try:
        if args.once:
            runner.run_once()
            return

        stop = Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        runner.run_forever(stop)
    finally:
        control.close()


if __name__ == "__main__":
    main()
