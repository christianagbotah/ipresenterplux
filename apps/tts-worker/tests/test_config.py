from __future__ import annotations

from pathlib import Path

import pytest

from ipresenter_tts.config import load_settings


def base_env(monkeypatch: pytest.MonkeyPatch, token_file: Path) -> None:
    monkeypatch.delenv("IPRESENTERPLUX_TTS_WORKER_TOKEN", raising=False)
    monkeypatch.delenv("IPRESENTERPLUX_TTS_GOOGLE_VOICE", raising=False)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_WORKER_TOKEN_FILE", str(token_file))
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "disabled")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_CONTROL_URL", "http://127.0.0.1:3011")


def secure_token(tmp_path: Path) -> Path:
    token = tmp_path / "token"
    token.write_text("x" * 48, encoding="utf-8")
    token.chmod(0o600)
    return token


def test_secure_token_file_loads(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = secure_token(tmp_path)
    base_env(monkeypatch, token)
    settings = load_settings()
    assert settings.worker_token == "x" * 48
    assert settings.provider == "disabled"
    assert settings.google_voice_name is None
    assert not settings.enabled


def test_insecure_token_file_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = tmp_path / "token"
    token.write_text("x" * 48, encoding="utf-8")
    token.chmod(0o644)
    base_env(monkeypatch, token)
    with pytest.raises(ValueError, match="must not be group/world accessible"):
        load_settings()


def test_remote_plain_http_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = secure_token(tmp_path)
    base_env(monkeypatch, token)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_CONTROL_URL", "http://example.com")
    with pytest.raises(ValueError, match="must use HTTPS"):
        load_settings()


def test_google_provider_requires_explicit_voice(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = secure_token(tmp_path)
    base_env(monkeypatch, token)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "google")
    with pytest.raises(ValueError, match="GOOGLE_VOICE is required"):
        load_settings()


def test_google_provider_accepts_explicit_voice(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = secure_token(tmp_path)
    base_env(monkeypatch, token)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "google")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GOOGLE_VOICE", "fr-FR-Neural2-G")
    settings = load_settings()
    assert settings.provider == "google"
    assert settings.google_voice_name == "fr-FR-Neural2-G"
    assert settings.enabled


def test_invalid_google_voice_name_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = secure_token(tmp_path)
    base_env(monkeypatch, token)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "google")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GOOGLE_VOICE", "fr-FR voice with spaces")
    with pytest.raises(ValueError, match="GOOGLE_VOICE is invalid"):
        load_settings()
