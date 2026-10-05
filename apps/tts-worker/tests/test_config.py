from __future__ import annotations

from pathlib import Path

import pytest

from ipresenter_tts.config import load_settings


def base_env(monkeypatch: pytest.MonkeyPatch, token_file: Path) -> None:
    monkeypatch.delenv("IPRESENTERPLUX_TTS_WORKER_TOKEN", raising=False)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_WORKER_TOKEN_FILE", str(token_file))
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "disabled")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_CONTROL_URL", "http://127.0.0.1:3011")


def test_secure_token_file_loads(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = tmp_path / "token"
    token.write_text("x" * 48, encoding="utf-8")
    token.chmod(0o600)
    base_env(monkeypatch, token)
    settings = load_settings()
    assert settings.worker_token == "x" * 48
    assert settings.provider == "disabled"
    assert not settings.enabled


def test_insecure_token_file_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = tmp_path / "token"
    token.write_text("x" * 48, encoding="utf-8")
    token.chmod(0o644)
    base_env(monkeypatch, token)
    with pytest.raises(ValueError, match="must not be group/world accessible"):
        load_settings()


def test_remote_plain_http_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = tmp_path / "token"
    token.write_text("x" * 48, encoding="utf-8")
    token.chmod(0o600)
    base_env(monkeypatch, token)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_CONTROL_URL", "http://example.com")
    with pytest.raises(ValueError, match="must use HTTPS"):
        load_settings()


def test_unimplemented_provider_cannot_be_enabled(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token = tmp_path / "token"
    token.write_text("x" * 48, encoding="utf-8")
    token.chmod(0o600)
    base_env(monkeypatch, token)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "google")
    with pytest.raises(ValueError, match="currently supports only disabled"):
        load_settings()
