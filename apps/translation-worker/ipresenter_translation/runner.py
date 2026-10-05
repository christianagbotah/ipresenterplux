from __future__ import annotations

import json
import os
import queue
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Thread
from typing import Callable, Protocol, TypeVar

from .config import Settings
from .models import TranslationJob, TranslationResult
from .providers.base import TranslationProvider, TranslationProviderError


class WorkerControl(Protocol):
    def claim(self) -> list[TranslationJob]: ...
    def complete(self, job: TranslationJob, translated_text: str, provider: str) -> None: ...
    def fail(self, job: TranslationJob, error_code: str) -> None: ...


@dataclass(slots=True)
class CycleResult:
    claimed: int = 0
    completed: int = 0
    failed: int = 0
    error_code: str | None = None


class _StopRequested(RuntimeError):
    pass


T = TypeVar("T")


class TranslationRunner:
    def __init__(
        self,
        settings: Settings,
        control: WorkerControl,
        provider: TranslationProvider,
        status_path: Path | None = None,
    ) -> None:
        self._settings = settings
        self._control = control
        self._provider = provider
        self._status_path = status_path
        self._provider_thread: Thread | None = None

    def run_once(self, stop: Event | None = None) -> CycleResult:
        result = CycleResult()
        if self._stopping(stop):
            return self._stopping_result(result)
        if not self._settings.enabled:
            result.error_code = "provider_disabled"
            self._write_status("disabled", result)
            return result

        try:
            ready = self._run_provider_call(
                self._provider.ready,
                stop,
                self._settings.provider_timeout_seconds,
                "provider_ready_timeout",
            )
        except _StopRequested:
            return self._stopping_result(result)
        except TranslationProviderError as exc:
            result.error_code = exc.code
            self._write_status("degraded", result)
            return result
        except Exception:
            result.error_code = "provider_unavailable"
            self._write_status("degraded", result)
            return result

        if not bool(ready):
            result.error_code = "provider_unavailable"
            self._write_status("degraded", result)
            return result
        if self._stopping(stop):
            return self._stopping_result(result)

        try:
            jobs = self._control.claim()
        except Exception:
            result.error_code = "control_unavailable"
            self._write_status("degraded", result)
            return result

        # The control client deliberately requests one job per lease until true
        # concurrent processing/lease renewal is implemented.
        result.claimed = len(jobs)
        for job in jobs:
            if self._stopping(stop):
                return self._stopping_result(result)
            try:
                translated = self._translate_bounded(job, stop)
                self._control.complete(job, translated.text, translated.provider)
                result.completed += 1
            except _StopRequested:
                return self._stopping_result(result)
            except TranslationProviderError as exc:
                result.failed += 1
                result.error_code = exc.code
                self._report_failure(job, exc.code)
            except Exception:
                result.failed += 1
                result.error_code = "worker_error"
                self._report_failure(job, "worker_error")

        state = "ready" if result.failed == 0 else "degraded"
        self._write_status(state, result)
        return result

    def run_forever(self, stop: Event) -> None:
        while not stop.is_set():
            self.run_once(stop)
            stop.wait(self._settings.poll_seconds)

    def _translate_bounded(self, job: TranslationJob, stop: Event | None) -> TranslationResult:
        value = self._run_provider_call(
            lambda: self._provider.translate(job),
            stop,
            self._settings.provider_timeout_seconds,
            "provider_timeout",
        )
        if not isinstance(value, TranslationResult):
            raise TranslationProviderError("invalid_provider_result")
        return value

    def _run_provider_call(
        self,
        operation: Callable[[], T],
        stop: Event | None,
        timeout_seconds: float,
        timeout_code: str,
    ) -> T:
        if self._provider_thread is not None:
            if self._provider_thread.is_alive():
                raise TranslationProviderError("provider_busy")
            self._provider_thread = None

        result_queue: queue.Queue[tuple[str, object]] = queue.Queue(maxsize=1)

        def invoke() -> None:
            try:
                result_queue.put(("ok", operation()))
            except Exception as exc:
                result_queue.put(("error", exc))

        worker = Thread(target=invoke, name="translation-provider-call", daemon=True)
        self._provider_thread = worker
        worker.start()
        deadline = time.monotonic() + timeout_seconds
        while True:
            if self._stopping(stop):
                raise _StopRequested()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TranslationProviderError(timeout_code)
            try:
                kind, value = result_queue.get(timeout=min(0.1, remaining))
            except queue.Empty:
                continue
            self._provider_thread = None
            if kind == "ok":
                return value  # type: ignore[return-value]
            if isinstance(value, TranslationProviderError):
                raise value
            if isinstance(value, Exception):
                raise value
            raise TranslationProviderError("invalid_provider_result")

    @staticmethod
    def _stopping(stop: Event | None) -> bool:
        return stop is not None and stop.is_set()

    def _stopping_result(self, result: CycleResult) -> CycleResult:
        result.error_code = "worker_stopping"
        self._write_status("stopping", result)
        return result

    def _report_failure(self, job: TranslationJob, code: str) -> None:
        try:
            self._control.fail(job, code[:64] or "translation_failed")
        except Exception:
            # The server lease expires and becomes reclaimable if result reporting fails.
            pass

    def _write_status(self, state: str, result: CycleResult) -> None:
        if self._status_path is None:
            return
        payload = {
            "state": state,
            "provider": self._settings.provider,
            "workerId": self._settings.worker_id,
            "claimed": result.claimed,
            "completed": result.completed,
            "failed": result.failed,
            "errorCode": result.error_code,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        self._status_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self._status_path.with_suffix(self._status_path.suffix + ".tmp")
        temp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
        os.replace(temp, self._status_path)
