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


def _safe_remote_url(value: str, name: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{name} must be an HTTP(S) URL")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError(f"Remote {name} must use HTTPS")
    return value.rstrip("/")


def _control_url() -> str:
    value = os.getenv("IPRESENTERPLUX_TTS_CONTROL_URL", "http://127.0.0.1:3011").strip().rstrip("/")
    return _safe_remote_url(value, "TTS control URLs")


def _read_secret(
    inline_name: str,
    file_name: str,
    label: str,
    *,
    required: bool,
) -> str | None:
    inline = os.environ.pop(inline_name, "").strip()
    token_file = os.getenv(file_name, "").strip()
    if inline and token_file:
        raise ValueError(f"Configure only one {label} source")
    if token_file:
        path = Path(token_file).expanduser().resolve()
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            raise ValueError(f"{label} file must not be group/world accessible")
        inline = path.read_text(encoding="utf-8").strip()
    if not inline:
        if required:
            raise ValueError(f"{label} is required")
        return None
    if len(inline) < 32 or len(inline) > 256:
        raise ValueError(f"{label} must contain 32 to 256 characters")
    return inline


def _worker_token() -> str:
    token = _read_secret(
        "IPRESENTERPLUX_TTS_WORKER_TOKEN",
        "IPRESENTERPLUX_TTS_WORKER_TOKEN_FILE",
        "TTS worker token",
        required=True,
    )
    assert token is not None
    return token


def _storage_dir() -> Path:
    raw = os.getenv("IPRESENTERPLUX_TTS_STORAGE_DIR", "/home/lightworld/webapps/ipresenterplux/storage").strip()
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ValueError("IPRESENTERPLUX_TTS_STORAGE_DIR must be an absolute path")
    return path.resolve()


def _voice_id(name: str) -> str | None:
    value = os.getenv(name, "").strip() or None
    if value is not None and (len(value) > 128 or not all(c.isalnum() or c in "._:-" for c in value)):
        raise ValueError(f"{name.removeprefix('IPRESENTERPLUX_TTS_')} is invalid")
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
    storage_dir: Path
    google_voice_name: str | None = None
    ghananlp_url: str | None = None
    ghananlp_token: str | None = None
    ghananlp_voice_id: str | None = None

    @property
    def enabled(self) -> bool:
        return self.provider != "disabled"


def load_settings() -> Settings:
    worker_id = os.getenv("IPRESENTERPLUX_TTS_WORKER_ID", "tts-worker-1").strip()
    if not worker_id or len(worker_id) > 64 or not all(c.isalnum() or c in "._:-" for c in worker_id):
        raise ValueError("IPRESENTERPLUX_TTS_WORKER_ID is invalid")

    provider = os.getenv("IPRESENTERPLUX_TTS_PROVIDER", "disabled").strip().lower()
    if provider not in {"disabled", "google", "ghananlp"}:
        raise ValueError("IPRESENTERPLUX_TTS_PROVIDER must be disabled, google or ghananlp")

    google_voice_name = _voice_id("IPRESENTERPLUX_TTS_GOOGLE_VOICE")
    if provider == "google" and google_voice_name is None:
        raise ValueError("IPRESENTERPLUX_TTS_GOOGLE_VOICE is required when Google TTS is enabled")

    raw_ghananlp_url = os.getenv("IPRESENTERPLUX_TTS_GHANANLP_URL", "").strip()
    ghananlp_url = _safe_remote_url(raw_ghananlp_url, "GHANANLP_URL") if raw_ghananlp_url else None
    ghananlp_token = _read_secret(
        "IPRESENTERPLUX_TTS_GHANANLP_TOKEN",
        "IPRESENTERPLUX_TTS_GHANANLP_TOKEN_FILE",
        "GHANANLP token",
        required=provider == "ghananlp",
    )
    ghananlp_voice_id = _voice_id("IPRESENTERPLUX_TTS_GHANANLP_VOICE")
    if provider == "ghananlp" and ghananlp_url is None:
        raise ValueError("IPRESENTERPLUX_TTS_GHANANLP_URL is required when GhanaNLP TTS is enabled")

    lease_seconds = _int_env("IPRESENTERPLUX_TTS_LEASE_SECONDS", 45, 15, 120)
    provider_timeout = _float_env("IPRESENTERPLUX_TTS_PROVIDER_TIMEOUT_SECONDS", 15.0, 1.0, 110.0)
    if provider_timeout >= lease_seconds - 2:
        raise ValueError("TTS provider timeout must be at least 2 seconds shorter than the lease")

    return Settings(
        control_url=_control_url(),
        worker_token=_worker_token(),
        worker_id=worker_id,
        provider=provider,
        poll_seconds=_float_env("IPRESENTERPLUX_TTS_POLL_SECONDS", 1.0, 0.25, 60.0),
        lease_seconds=lease_seconds,
        request_timeout_seconds=_float_env("IPRESENTERPLUX_TTS_HTTP_TIMEOUT_SECONDS", 10.0, 1.0, 60.0),
        provider_timeout_seconds=provider_timeout,
        storage_dir=_storage_dir(),
        google_voice_name=google_voice_name,
        ghananlp_url=ghananlp_url,
        ghananlp_token=ghananlp_token,
        ghananlp_voice_id=ghananlp_voice_id,
    )
