from __future__ import annotations

import pytest

from ipresenter_asr.config import is_loopback_host, load_settings


def test_loopback_detection() -> None:
    assert is_loopback_host("127.0.0.1")
    assert is_loopback_host("::1")
    assert is_loopback_host("localhost")
    assert not is_loopback_host("0.0.0.0")


def test_remote_bind_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_ASR_HOST", "0.0.0.0")
    monkeypatch.delenv("IPRESENTERPLUX_ASR_TOKEN", raising=False)
    with pytest.raises(ValueError, match="bearer token"):
        load_settings()


def test_token_is_removed_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_ASR_TOKEN", "secret-worker-token")
    settings = load_settings()
    assert settings.token == "secret-worker-token"
    assert "IPRESENTERPLUX_ASR_TOKEN" not in __import__("os").environ


def test_unapproved_diarization_provider_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER", "surprise-model")
    with pytest.raises(ValueError, match="currently supports only disabled"):
        load_settings()
