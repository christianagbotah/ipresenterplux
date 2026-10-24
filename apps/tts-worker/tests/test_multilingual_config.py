from __future__ import annotations

from pathlib import Path

import pytest

from ipresenter_tts.config import load_settings


def _token(path: Path, value: str) -> Path:
    path.write_text(value, encoding="utf-8")
    path.chmod(0o600)
    return path


def _base(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in (
        "IPRESENTERPLUX_TTS_WORKER_TOKEN",
        "IPRESENTERPLUX_TTS_GOOGLE_VOICE",
        "IPRESENTERPLUX_TTS_GOOGLE_VOICE_EN",
        "IPRESENTERPLUX_TTS_GOOGLE_VOICE_FR",
        "IPRESENTERPLUX_TTS_GHANANLP_URL",
        "IPRESENTERPLUX_TTS_GHANANLP_TOKEN",
        "IPRESENTERPLUX_TTS_GHANANLP_TOKEN_FILE",
        "IPRESENTERPLUX_TTS_GHANANLP_VOICE",
    ):
        monkeypatch.delenv(name, raising=False)
    worker = _token(tmp_path / "worker-token", "w" * 48)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_WORKER_TOKEN_FILE", str(worker))
    monkeypatch.setenv("IPRESENTERPLUX_TTS_CONTROL_URL", "http://127.0.0.1:3011")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_PROVIDER", "multilingual")


def test_multilingual_provider_requires_both_google_generic_voices(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _base(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="GOOGLE_VOICE_EN and GOOGLE_VOICE_FR"):
        load_settings()


def test_multilingual_provider_loads_all_four_language_routes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _base(monkeypatch, tmp_path)
    ghana = _token(tmp_path / "ghana-token", "g" * 48)
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GOOGLE_VOICE_EN", "en-US-Neural2-D")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GOOGLE_VOICE_FR", "fr-FR-Neural2-G")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GHANANLP_URL", "https://voice.example.test")
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GHANANLP_TOKEN_FILE", str(ghana))
    monkeypatch.setenv("IPRESENTERPLUX_TTS_GHANANLP_VOICE", "ghana-generic-1")

    settings = load_settings()

    assert settings.provider == "multilingual"
    assert settings.google_voice_en == "en-US-Neural2-D"
    assert settings.google_voice_fr == "fr-FR-Neural2-G"
    assert settings.ghananlp_url == "https://voice.example.test"
    assert settings.ghananlp_token == "g" * 48
    assert settings.ghananlp_voice_id == "ghana-generic-1"
    assert settings.enabled
