from __future__ import annotations

import pytest

from ipresenter_tts.providers.base import TtsProviderError
from ipresenter_tts.providers.google import _language_code, _wav_duration_ms


def make_wav(data_size: int = 3200, byte_rate: int = 32000) -> bytes:
    fmt = (
        (1).to_bytes(2, "little")
        + (1).to_bytes(2, "little")
        + (16000).to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little")
        + (2).to_bytes(2, "little")
        + (16).to_bytes(2, "little")
    )
    data = bytes(data_size)
    riff_size = 4 + 8 + len(fmt) + 8 + len(data)
    return (
        b"RIFF"
        + riff_size.to_bytes(4, "little")
        + b"WAVE"
        + b"fmt "
        + len(fmt).to_bytes(4, "little")
        + fmt
        + b"data"
        + len(data).to_bytes(4, "little")
        + data
    )


def test_french_language_mapping() -> None:
    assert _language_code("fr") == "fr-FR"
    assert _language_code("fr-CA") == "fr-CA"


def test_unvalidated_bare_language_is_rejected() -> None:
    with pytest.raises(TtsProviderError) as error:
        _language_code("gaa")
    assert error.value.code == "unsupported_language"


def test_wav_duration_is_exact() -> None:
    assert _wav_duration_ms(make_wav(3200, 32000)) == 100


def test_invalid_wav_is_rejected() -> None:
    with pytest.raises(TtsProviderError) as error:
        _wav_duration_ms(b"not wav")
    assert error.value.code == "invalid_audio_response"
