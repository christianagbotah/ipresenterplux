from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean value")


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


def is_loopback_host(host: str) -> bool:
    value = host.strip().lower()
    if value == "localhost":
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True, slots=True)
class Settings:
    host: str
    port: int
    token: str | None
    model: str
    model_dir: Path | None
    local_files_only: bool
    device: str
    compute_type: str
    language: str | None
    beam_size: int
    max_audio_bytes: int
    diarization_provider: str = "disabled"
    sample_rate: int = 16_000
    diarization_model_dir: Path | None = None
    diarization_similarity_threshold: float = 0.72
    diarization_max_speakers: int = 12
    diarization_session_ttl_seconds: int = 6 * 60 * 60

    @property
    def remote_bind(self) -> bool:
        return not is_loopback_host(self.host)


def load_settings() -> Settings:
    host = os.getenv("IPRESENTERPLUX_ASR_HOST", "127.0.0.1").strip()
    token = os.environ.pop("IPRESENTERPLUX_ASR_TOKEN", None)
    token = token.strip() if token and token.strip() else None
    if not host:
        raise ValueError("IPRESENTERPLUX_ASR_HOST must not be empty")
    if not is_loopback_host(host) and not token:
        raise ValueError("A bearer token is required when the ASR worker binds beyond loopback")

    model_dir_raw = os.getenv("IPRESENTERPLUX_ASR_MODEL_DIR")
    model_dir = Path(model_dir_raw).expanduser().resolve() if model_dir_raw else None
    language = os.getenv("IPRESENTERPLUX_ASR_LANGUAGE")
    language = language.strip() if language and language.strip() else None

    diarization_provider = os.getenv("IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER", "disabled").strip().lower()
    if diarization_provider not in {"disabled", "speechbrain_ecapa"}:
        raise ValueError("IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER must be disabled or speechbrain_ecapa")
    diarization_model_raw = os.getenv("IPRESENTERPLUX_ASR_DIARIZATION_MODEL_DIR")
    diarization_model_dir = Path(diarization_model_raw).expanduser().resolve() if diarization_model_raw else None
    if diarization_provider == "speechbrain_ecapa":
        if diarization_model_dir is None or not diarization_model_dir.is_dir():
            raise ValueError("SpeechBrain diarization requires a local model directory via IPRESENTERPLUX_ASR_DIARIZATION_MODEL_DIR")
        if not (diarization_model_dir / "hyperparams.yaml").is_file():
            raise ValueError("SpeechBrain diarization model directory must contain hyperparams.yaml")

    return Settings(
        host=host,
        port=_int_env("IPRESENTERPLUX_ASR_PORT", 8765, 1, 65535),
        token=token,
        model=os.getenv("IPRESENTERPLUX_ASR_MODEL", "small").strip() or "small",
        model_dir=model_dir,
        local_files_only=_bool_env("IPRESENTERPLUX_ASR_LOCAL_FILES_ONLY", True),
        device=os.getenv("IPRESENTERPLUX_ASR_DEVICE", "auto").strip() or "auto",
        compute_type=os.getenv("IPRESENTERPLUX_ASR_COMPUTE_TYPE", "default").strip() or "default",
        language=language,
        beam_size=_int_env("IPRESENTERPLUX_ASR_BEAM_SIZE", 3, 1, 10),
        max_audio_bytes=_int_env("IPRESENTERPLUX_ASR_MAX_AUDIO_BYTES", 1_000_000, 32_000, 8_000_000),
        diarization_provider=diarization_provider,
        diarization_model_dir=diarization_model_dir,
        diarization_similarity_threshold=_float_env(
            "IPRESENTERPLUX_ASR_DIARIZATION_SIMILARITY", 0.72, 0.40, 0.95
        ),
        diarization_max_speakers=_int_env("IPRESENTERPLUX_ASR_DIARIZATION_MAX_SPEAKERS", 12, 1, 64),
        diarization_session_ttl_seconds=_int_env(
            "IPRESENTERPLUX_ASR_DIARIZATION_SESSION_TTL_SECONDS", 6 * 60 * 60, 60, 24 * 60 * 60
        ),
    )
