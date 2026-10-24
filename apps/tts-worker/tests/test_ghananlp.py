from __future__ import annotations

import json

import pytest

from ipresenter_tts.models import TtsJob
from ipresenter_tts.providers.base import TtsProviderError
from ipresenter_tts.providers.ghananlp import GhanaNlpTtsProvider


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
    return b"RIFF" + riff_size.to_bytes(4, "little") + b"WAVE" + b"fmt " + len(fmt).to_bytes(4, "little") + fmt + b"data" + len(data).to_bytes(4, "little") + data


def job(**changes) -> TtsJob:
    values = dict(
        id="11111111-1111-4111-8111-111111111111",
        lease_token="22222222-2222-4222-8222-222222222222",
        service_id="33333333-3333-4333-8333-333333333333",
        organization_id="44444444-4444-4444-8444-444444444444",
        source_text="Onyame nhyira mo nyinaa",
        source_text_hash="a" * 64,
        target_language_code="twi",
        voice_profile_id=None,
        voice_provider=None,
        provider_voice_id=None,
        attempts=1,
    )
    values.update(changes)
    return TtsJob(**values)


class FakeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"", content_type: str = "audio/wav") -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": content_type}


class FakeClient:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.posts: list[dict] = []
        self.gets: list[str] = []

    def get(self, url: str, **kwargs):
        self.gets.append(url)
        return FakeResponse(200, b"{}", "application/json")

    def post(self, url: str, **kwargs):
        self.posts.append({"url": url, **kwargs})
        return self.response


def test_twi_generic_synthesis_uses_canonical_akan_code() -> None:
    client = FakeClient(FakeResponse(content=make_wav()))
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", "generic-gh", client=client)
    result = provider.synthesize(job(target_language_code="twi"))
    assert result.content_type == "audio/wav"
    assert result.duration_ms == 100
    request = client.posts[0]
    assert request["url"] == "https://voice.example.test/v1/synthesize"
    assert request["headers"]["Authorization"] == "Bearer secret-token"
    assert request["json"] == {"text": "Onyame nhyira mo nyinaa", "language": "ak", "voiceId": "generic-gh"}


def test_ewe_personalized_voice_routes_bound_provider_voice() -> None:
    client = FakeClient(FakeResponse(content=make_wav()))
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", "generic-gh", client=client)
    provider.synthesize(job(
        source_text="Mawu nayra mi katã",
        target_language_code="ewe",
        voice_profile_id="profile-1",
        voice_provider="ghananlp",
        provider_voice_id="preacher-consented-voice",
    ))
    assert client.posts[0]["json"] == {"text": "Mawu nayra mi katã", "language": "ee", "voiceId": "preacher-consented-voice"}


def test_personalized_voice_provider_mismatch_fails_before_network() -> None:
    client = FakeClient(FakeResponse(content=make_wav()))
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", "generic-gh", client=client)
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job(voice_profile_id="profile-1", voice_provider="google", provider_voice_id="voice-1"))
    assert error.value.code == "voice_provider_mismatch"
    assert client.posts == []


def test_personalized_voice_requires_provider_voice_id() -> None:
    client = FakeClient(FakeResponse(content=make_wav()))
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", "generic-gh", client=client)
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job(voice_profile_id="profile-1", voice_provider="ghananlp", provider_voice_id=None))
    assert error.value.code == "voice_provider_mismatch"
    assert client.posts == []


def test_generic_synthesis_requires_explicit_generic_voice() -> None:
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", None, client=FakeClient(FakeResponse(content=make_wav())))
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job())
    assert error.value.code == "voice_not_configured"


def test_non_wav_provider_response_is_rejected() -> None:
    client = FakeClient(FakeResponse(content=b"not-a-wave", content_type="audio/wav"))
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", "generic-gh", client=client)
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job())
    assert error.value.code == "invalid_audio_response"


def test_wrong_content_type_is_rejected() -> None:
    client = FakeClient(FakeResponse(content=make_wav(), content_type="application/json"))
    provider = GhanaNlpTtsProvider("https://voice.example.test", "secret-token", "generic-gh", client=client)
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job())
    assert error.value.code == "invalid_audio_content_type"
