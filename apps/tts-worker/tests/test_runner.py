from __future__ import annotations

import json
import time
from pathlib import Path
from threading import Event, Timer

from ipresenter_tts.config import Settings
from ipresenter_tts.control import CompletionRejected
from ipresenter_tts.models import StoredAsset, SynthesisResult, TtsJob
from ipresenter_tts.providers.base import TtsProviderError
from ipresenter_tts.runner import TtsRunner
from ipresenter_tts.storage import AudioStore

JOB_ID = "11111111-1111-4111-8111-111111111111"
LEASE = "22222222-2222-4222-8222-222222222222"


def settings(tmp_path: Path, provider: str = "disabled", provider_timeout: float = 2.0) -> Settings:
    return Settings(
        "http://127.0.0.1:3011",
        "x" * 48,
        "tts-test-worker",
        provider,
        1.0,
        45,
        5.0,
        provider_timeout,
        tmp_path / "storage",
    )


def job() -> TtsJob:
    return TtsJob(
        JOB_ID,
        LEASE,
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "Bonjour church",
        "a" * 64,
        "fr",
        None,
        None,
        None,
        1,
    )


def wav_bytes() -> bytes:
    return b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"fmt " + b"\x00" * 32


class FakeControl:
    def __init__(self, jobs: list[TtsJob] | None = None, complete_error: Exception | None = None) -> None:
        self.jobs = jobs or []
        self.complete_error = complete_error
        self.claims = 0
        self.completed: list[tuple[str, str, str]] = []
        self.failed: list[tuple[str, str]] = []

    def claim(self) -> list[TtsJob]:
        self.claims += 1
        return self.jobs

    def complete(self, item: TtsJob, asset: StoredAsset, provider: str) -> None:
        if self.complete_error is not None:
            raise self.complete_error
        self.completed.append((item.id, asset.asset_key, provider))

    def fail(self, item: TtsJob, error_code: str) -> None:
        self.failed.append((item.id, error_code))


class FakeProvider:
    name = "fake"

    def __init__(self, ready: bool = True, fail: bool = False, delay: float = 0.0, ready_delay: float = 0.0) -> None:
        self._ready = ready
        self._fail = fail
        self._delay = delay
        self._ready_delay = ready_delay

    def ready(self) -> bool:
        if self._ready_delay:
            time.sleep(self._ready_delay)
        return self._ready

    def synthesize(self, item: TtsJob) -> SynthesisResult:
        del item
        if self._delay:
            time.sleep(self._delay)
        if self._fail:
            raise TtsProviderError("provider_request_failed")
        return SynthesisResult(wav_bytes(), "audio/wav", 900, self.name)


class StopOnReadyProvider(FakeProvider):
    def __init__(self, stop: Event) -> None:
        super().__init__()
        self._stop = stop

    def ready(self) -> bool:
        self._stop.set()
        return True


def runner(tmp_path: Path, control: FakeControl, provider: FakeProvider, provider_name: str = "fake", timeout: float = 2.0) -> TtsRunner:
    cfg = settings(tmp_path, provider_name, timeout)
    return TtsRunner(cfg, control, provider, AudioStore(cfg.storage_dir), tmp_path / "status.json")


def asset_path(tmp_path: Path) -> Path:
    return tmp_path / "storage" / "tts" / JOB_ID / f"{LEASE}.wav"


def test_disabled_worker_never_claims(tmp_path: Path) -> None:
    control = FakeControl([job()])
    result = runner(tmp_path, control, FakeProvider(), provider_name="disabled").run_once()
    assert result.claimed == 0
    assert control.claims == 0
    status = json.loads((tmp_path / "status.json").read_text())
    assert status["state"] == "disabled"
    assert "Bonjour church" not in (tmp_path / "status.json").read_text()


def test_success_stores_lease_scoped_asset_and_completes(tmp_path: Path) -> None:
    control = FakeControl([job()])
    result = runner(tmp_path, control, FakeProvider()).run_once()
    assert result.completed == 1
    assert control.completed == [(JOB_ID, f"tts/{JOB_ID}/{LEASE}.wav", "fake")]
    assert asset_path(tmp_path).exists()
    assert asset_path(tmp_path).stat().st_mode & 0o077 == 0


def test_provider_failure_reports_safe_code(tmp_path: Path) -> None:
    control = FakeControl([job()])
    result = runner(tmp_path, control, FakeProvider(fail=True)).run_once()
    assert result.failed == 1
    assert control.failed == [(JOB_ID, "provider_request_failed")]
    assert "Bonjour church" not in (tmp_path / "status.json").read_text()


def test_explicit_completion_rejection_removes_asset(tmp_path: Path) -> None:
    control = FakeControl([job()], CompletionRejected("stale lease"))
    result = runner(tmp_path, control, FakeProvider()).run_once()
    assert result.error_code == "completion_rejected"
    assert not asset_path(tmp_path).exists()


def test_uncertain_completion_failure_keeps_asset(tmp_path: Path) -> None:
    control = FakeControl([job()], RuntimeError("connection reset"))
    result = runner(tmp_path, control, FakeProvider()).run_once()
    assert result.error_code == "worker_error"
    assert asset_path(tmp_path).exists()
    assert control.failed == [(JOB_ID, "worker_error")]


def test_provider_timeout_blocks_new_claims_until_call_finishes(tmp_path: Path) -> None:
    control = FakeControl([job()])
    worker = runner(tmp_path, control, FakeProvider(delay=0.3), timeout=0.05)
    first = worker.run_once()
    assert first.error_code == "provider_timeout"
    assert control.claims == 1
    second = worker.run_once()
    assert second.error_code == "provider_busy"
    assert control.claims == 1


def test_readiness_timeout_does_not_claim(tmp_path: Path) -> None:
    control = FakeControl([job()])
    worker = runner(tmp_path, control, FakeProvider(ready_delay=0.3), timeout=0.05)
    result = worker.run_once()
    assert result.error_code == "provider_ready_timeout"
    assert control.claims == 0
    assert worker.run_once().error_code == "provider_busy"
    assert control.claims == 0


def test_stop_after_readiness_prevents_claim(tmp_path: Path) -> None:
    control = FakeControl([job()])
    stop = Event()
    result = runner(tmp_path, control, StopOnReadyProvider(stop)).run_once(stop)
    assert result.error_code == "worker_stopping"
    assert control.claims == 0


def test_stop_interrupts_active_provider_wait(tmp_path: Path) -> None:
    control = FakeControl([job()])
    stop = Event()
    worker = runner(tmp_path, control, FakeProvider(delay=0.5), timeout=1.0)
    timer = Timer(0.05, stop.set)
    timer.start()
    started = time.monotonic()
    try:
        result = worker.run_once(stop)
    finally:
        timer.cancel()
    assert time.monotonic() - started < 0.3
    assert result.error_code == "worker_stopping"
    assert control.completed == []
