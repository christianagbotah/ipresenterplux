from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
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


def _worker_token() -> str:
    inline = os.environ.pop("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN", "").strip()
    token_file = os.getenv("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN_FILE", "").strip()
    if inline and token_file:
        raise ValueError("Configure only one translation worker token source")
    if token_file:
        path = Path(token_file).expanduser().resolve()
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            raise ValueError("Translation worker token file must not be group/world accessible")
        inline = path.read_text(encoding="utf-8").strip()
    if len(inline) < 32 or len(inline) > 256:
        raise ValueError("Translation worker token must contain 32 to 256 characters")
    return inline


def load_settings() -> Settings:
    token = _worker_token()

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
