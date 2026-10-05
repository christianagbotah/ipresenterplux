from __future__ import annotations

from pathlib import Path

import pytest

from ipresenter_tts.models import SynthesisResult, TtsJob
from ipresenter_tts.providers.base import TtsProviderError
from ipresenter_tts.storage import AudioStore


def job() -> TtsJob:
    return TtsJob(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "Bonjour",
        "a" * 64,
        "fr",
        None,
        None,
        None,
        1,
    )


def wav_bytes() -> bytes:
    return b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"fmt " + b"\x00" * 32


def test_store_writes_job_scoped_asset_atomically(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    asset = store.store(job(), SynthesisResult(wav_bytes(), "audio/wav", 900, "fake"))
    path = Path(asset.absolute_path)
    assert asset.asset_key == "tts/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.wav"
    assert path.exists()
    assert path.read_bytes() == wav_bytes()
    assert path.stat().st_mode & 0o077 == 0
    store.remove(asset)
    assert not path.exists()


def test_invalid_magic_is_rejected(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    with pytest.raises(TtsProviderError, match="TTS provider failed") as error:
        store.store(job(), SynthesisResult(b"not-a-wave", "audio/wav", 900, "fake"))
    assert error.value.code == "invalid_audio_payload"


def test_unsupported_format_is_rejected(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    with pytest.raises(TtsProviderError) as error:
        store.store(job(), SynthesisResult(b"data", "audio/flac", 900, "fake"))
    assert error.value.code == "unsupported_audio_format"
