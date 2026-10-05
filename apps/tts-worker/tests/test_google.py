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


class _FakeVoiceSelectionParams:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _FakeSynthesisInput:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _FakeAudioConfig:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _FakeTextToSpeech:
    class AudioEncoding:
        LINEAR16 = "LINEAR16"

    VoiceSelectionParams = _FakeVoiceSelectionParams
    SynthesisInput = _FakeSynthesisInput
    AudioConfig = _FakeAudioConfig


class _FakeClient:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.calls = []

    def synthesize_speech(self, **kwargs):
        self.calls.append(kwargs)
        return type("Response", (), {"audio_content": self.payload})()


def _job(**changes):
    from ipresenter_tts.models import TtsJob

    values = dict(
        id="11111111-1111-4111-8111-111111111111",
        lease_token="22222222-2222-4222-8222-222222222222",
        service_id="33333333-3333-4333-8333-333333333333",
        organization_id="44444444-4444-4444-8444-444444444444",
        source_text="Bonjour à tous",
        source_text_hash="a" * 64,
        target_language_code="fr",
        voice_profile_id=None,
        voice_provider=None,
        provider_voice_id=None,
        attempts=1,
    )
    values.update(changes)
    return TtsJob(**values)


def test_explicit_french_voice_is_used() -> None:
    from ipresenter_tts.providers.google import GoogleCloudTtsProvider

    client = _FakeClient(make_wav())
    provider = GoogleCloudTtsProvider("fr-FR-Neural2-G")
    provider._get_client = lambda: (client, _FakeTextToSpeech)  # type: ignore[method-assign]
    result = provider.synthesize(_job())
    assert result.content_type == "audio/wav"
    assert result.duration_ms == 100
    voice = client.calls[0]["voice"]
    assert voice.kwargs == {"language_code": "fr-FR", "name": "fr-FR-Neural2-G"}


def test_generic_voice_language_mismatch_is_rejected() -> None:
    from ipresenter_tts.providers.google import GoogleCloudTtsProvider

    provider = GoogleCloudTtsProvider("en-US-Neural2-A")
    provider._get_client = lambda: (_FakeClient(make_wav()), _FakeTextToSpeech)  # type: ignore[method-assign]
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(_job())
    assert error.value.code == "voice_language_mismatch"


def test_personalized_voice_requires_google_provider_match() -> None:
    from ipresenter_tts.providers.google import GoogleCloudTtsProvider

    provider = GoogleCloudTtsProvider("fr-FR-Neural2-G")
    provider._get_client = lambda: (_FakeClient(make_wav()), _FakeTextToSpeech)  # type: ignore[method-assign]
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(_job(voice_profile_id="profile-1", voice_provider="other", provider_voice_id="voice-1"))
    assert error.value.code == "voice_provider_mismatch"


def test_personalized_google_voice_id_overrides_default() -> None:
    from ipresenter_tts.providers.google import GoogleCloudTtsProvider

    client = _FakeClient(make_wav())
    provider = GoogleCloudTtsProvider("fr-FR-Neural2-G")
    provider._get_client = lambda: (client, _FakeTextToSpeech)  # type: ignore[method-assign]
    provider.synthesize(_job(voice_profile_id="profile-1", voice_provider="google", provider_voice_id="fr-FR-Custom-Voice"))
    voice = client.calls[0]["voice"]
    assert voice.kwargs == {"language_code": "fr-FR", "name": "fr-FR-Custom-Voice"}
