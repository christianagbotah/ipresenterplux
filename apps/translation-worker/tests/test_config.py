from __future__ import annotations

import pytest

from ipresenter_translation.config import load_settings


def test_disabled_provider_is_safe_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN", "x" * 48)
    monkeypatch.delenv("IPRESENTERPLUX_TRANSLATION_PROVIDER", raising=False)
    settings = load_settings()
    assert settings.provider == "disabled"
    assert settings.enabled is False


def test_remote_control_requires_https(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN", "x" * 48)
    monkeypatch.setenv("IPRESENTERPLUX_TRANSLATION_CONTROL_URL", "http://example.com")
    with pytest.raises(ValueError, match="HTTPS"):
        load_settings()


def test_worker_token_is_removed_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN", "secret-token-" + "x" * 40)
    settings = load_settings()
    assert len(settings.worker_token) >= 32
    import os
    assert "IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN" not in os.environ
