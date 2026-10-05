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
    with pytest.raises(ValueError, match="disabled or speechbrain_ecapa"):
        load_settings()


def test_speechbrain_provider_requires_local_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER", "speechbrain_ecapa")
    monkeypatch.delenv("IPRESENTERPLUX_ASR_DIARIZATION_MODEL_DIR", raising=False)
    with pytest.raises(ValueError, match="local model directory"):
        load_settings()


def test_speechbrain_provider_accepts_local_model_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    (tmp_path / "hyperparams.yaml").write_text("# test fixture\n", encoding="utf-8")
    monkeypatch.setenv("IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER", "speechbrain_ecapa")
    monkeypatch.setenv("IPRESENTERPLUX_ASR_DIARIZATION_MODEL_DIR", str(tmp_path))
    settings = load_settings()
    assert settings.diarization_provider == "speechbrain_ecapa"
    assert settings.diarization_model_dir == tmp_path.resolve()


def test_diarization_threshold_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IPRESENTERPLUX_ASR_DIARIZATION_SIMILARITY", "0.99")
    with pytest.raises(ValueError, match="between 0.4 and 0.95"):
        load_settings()
