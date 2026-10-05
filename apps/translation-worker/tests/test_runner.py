from __future__ import annotations

import json
import time
from pathlib import Path
from threading import Event, Timer

from ipresenter_translation.config import Settings
from ipresenter_translation.models import TranslationJob, TranslationResult
from ipresenter_translation.providers.base import TranslationProviderError
from ipresenter_translation.runner import TranslationRunner


def settings(provider: str = "disabled", provider_timeout: float = 2.0) -> Settings:
    return Settings("http://127.0.0.1:3011", "x" * 48, "test-worker", provider, 1.0, 45, 5.0, provider_timeout)


class FakeControl:
    def __init__(self, jobs: list[TranslationJob] | None = None) -> None:
        self.jobs = jobs or []
        self.claims = 0
        self.completed: list[tuple[str, str, str]] = []
        self.failed: list[tuple[str, str]] = []
        self.heartbeats: list[tuple[str, int, int, int, str | None]] = []

    def claim(self) -> list[TranslationJob]:
        self.claims += 1
        return self.jobs

    def complete(self, job: TranslationJob, translated_text: str, provider: str) -> None:
        self.completed.append((job.id, translated_text, provider))

    def fail(self, job: TranslationJob, error_code: str) -> None:
        self.failed.append((job.id, error_code))

    def heartbeat(self, state: str, claimed: int, completed: int, failed: int, error_code: str | None) -> None:
        self.heartbeats.append((state, claimed, completed, failed, error_code))


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
    def translate(self, job: TranslationJob) -> TranslationResult:
        if self._delay:
            time.sleep(self._delay)
        if self._fail:
            raise TranslationProviderError("provider_request_failed")
        return TranslationResult(f"translated:{job.source_text}", self.name)


class StopOnReadyProvider(FakeProvider):
    def __init__(self, stop: Event) -> None:
        super().__init__()
        self._stop = stop
    def ready(self) -> bool:
        self._stop.set()
        return True


def job() -> TranslationJob:
    return TranslationJob("job-1", "lease-1", "service-1", "Hello church", "en", "fr", "translation_audio", 1)


def test_disabled_worker_never_claims(tmp_path: Path) -> None:
    control = FakeControl([job()])
    status = tmp_path / "status.json"
    result = TranslationRunner(settings(), control, FakeProvider(), status).run_once()
    assert result.claimed == 0
    assert control.claims == 0
    assert json.loads(status.read_text())["state"] == "disabled"
    assert control.heartbeats[-1] == ("disabled", 0, 0, 0, "provider_disabled")


def test_success_completes_leased_job(tmp_path: Path) -> None:
    control = FakeControl([job()])
    result = TranslationRunner(settings("google"), control, FakeProvider(), tmp_path / "status.json").run_once()
    assert result.completed == 1
    assert control.completed == [("job-1", "translated:Hello church", "fake")]
    assert control.heartbeats[-1] == ("ready", 1, 1, 0, None)


def test_provider_failure_reports_safe_code(tmp_path: Path) -> None:
    control = FakeControl([job()])
    result = TranslationRunner(settings("google"), control, FakeProvider(fail=True), tmp_path / "status.json").run_once()
    assert result.failed == 1
    assert control.failed == [("job-1", "provider_request_failed")]
    assert "Hello church" not in (tmp_path / "status.json").read_text()


def test_provider_timeout_blocks_new_claims_until_call_finishes(tmp_path: Path) -> None:
    control = FakeControl([job()])
    runner = TranslationRunner(settings("google", 0.05), control, FakeProvider(delay=0.3), tmp_path / "status.json")
    first = runner.run_once()
    assert first.error_code == "provider_timeout"
    assert control.claims == 1
    second = runner.run_once()
    assert second.error_code == "provider_busy"
    assert control.claims == 1


def test_readiness_is_bounded_and_does_not_claim(tmp_path: Path) -> None:
    control = FakeControl([job()])
    runner = TranslationRunner(settings("google", 0.05), control, FakeProvider(ready_delay=0.3), tmp_path / "status.json")
    result = runner.run_once()
    assert result.error_code == "provider_ready_timeout"
    assert control.claims == 0
    assert runner.run_once().error_code == "provider_busy"
    assert control.claims == 0


def test_stop_after_readiness_prevents_claim(tmp_path: Path) -> None:
    control = FakeControl([job()])
    stop = Event()
    result = TranslationRunner(settings("google"), control, StopOnReadyProvider(stop), tmp_path / "status.json").run_once(stop)
    assert result.error_code == "worker_stopping"
    assert control.claims == 0


def test_stop_interrupts_wait_for_active_provider_call(tmp_path: Path) -> None:
    control = FakeControl([job()])
    stop = Event()
    runner = TranslationRunner(settings("google", 1.0), control, FakeProvider(delay=0.5), tmp_path / "status.json")
    timer = Timer(0.05, stop.set)
    timer.start()
    started = time.monotonic()
    try:
        result = runner.run_once(stop)
    finally:
        timer.cancel()
    assert time.monotonic() - started < 0.3
    assert result.error_code == "worker_stopping"
    assert control.completed == []


def test_stop_before_cycle_does_not_claim(tmp_path: Path) -> None:
    control = FakeControl([job()])
    stop = Event(); stop.set()
    result = TranslationRunner(settings("google"), control, FakeProvider(), tmp_path / "status.json").run_once(stop)
    assert result.error_code == "worker_stopping"
    assert control.claims == 0
