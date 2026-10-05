from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    value = default if raw is None else int(raw)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name)
    value = default if raw is None else float(raw)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _control_url() -> str:
    value = os.getenv("IPRESENTERPLUX_TRANSLATION_CONTROL_URL", "http://127.0.0.1:3011").strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("IPRESENTERPLUX_TRANSLATION_CONTROL_URL must be an HTTP(S) URL")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Remote translation control URLs must use HTTPS")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    control_url: str
    worker_token: str
    worker_id: str
    provider: str
    poll_seconds: float
    lease_seconds: int
    request_timeout_seconds: float
    provider_timeout_seconds: float

    @property
    def enabled(self) -> bool:
        return self.provider != "disabled"


def load_settings() -> Settings:
    token = os.environ.pop("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN", "").strip()
    if len(token) < 32 or len(token) > 256:
        raise ValueError("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN must contain 32 to 256 characters")

    worker_id = os.getenv("IPRESENTERPLUX_TRANSLATION_WORKER_ID", "translation-worker-1").strip()
    if not worker_id or len(worker_id) > 64 or not all(c.isalnum() or c in "._:-" for c in worker_id):
        raise ValueError("IPRESENTERPLUX_TRANSLATION_WORKER_ID is invalid")

    provider = os.getenv("IPRESENTERPLUX_TRANSLATION_PROVIDER", "disabled").strip().lower()
    if provider not in {"disabled", "google"}:
        raise ValueError("IPRESENTERPLUX_TRANSLATION_PROVIDER must be disabled or google")

    lease_seconds = _int_env("IPRESENTERPLUX_TRANSLATION_LEASE_SECONDS", 45, 15, 300)
    provider_timeout = _float_env("IPRESENTERPLUX_TRANSLATION_PROVIDER_TIMEOUT_SECONDS", 15.0, 1.0, 240.0)
    if provider_timeout >= lease_seconds - 2:
        raise ValueError("Translation provider timeout must be at least 2 seconds shorter than the lease")

    return Settings(
        control_url=_control_url(),
        worker_token=token,
        worker_id=worker_id,
        provider=provider,
        poll_seconds=_float_env("IPRESENTERPLUX_TRANSLATION_POLL_SECONDS", 1.0, 0.25, 60.0),
        lease_seconds=lease_seconds,
        request_timeout_seconds=_float_env("IPRESENTERPLUX_TRANSLATION_HTTP_TIMEOUT_SECONDS", 10.0, 1.0, 60.0),
        provider_timeout_seconds=provider_timeout,
    )
