from __future__ import annotations

import pytest

from ipresenter_tts.models import TtsJob
from ipresenter_tts.providers.base import TtsProviderError
from ipresenter_tts.providers.khaya import KhayaTtsProvider, _khaya_language


def make_wav(data_size: int = 3200, byte_rate: int = 32000) -> bytes:
    fmt = (
        (1).to_bytes(2, "little") + (1).to_bytes(2, "little") + (16000).to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little") + (2).to_bytes(2, "little") + (16).to_bytes(2, "little")
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


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("en", "eng"), ("fr", "fra"), ("ak", "twi"), ("twi", "twi"), ("ee", "ewe"), ("ewe", "ewe"), ("gaa", "gaa"), ("ga", "gaa")],
)
def test_khaya_tts_language_codes(raw: str, expected: str) -> None:
    assert _khaya_language(raw) == expected


class FakeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"", content_type: str = "audio/wav") -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": content_type}


class FakeClient:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.posts: list[dict] = []

    def post(self, url: str, **kwargs):
        self.posts.append({"url": url, **kwargs})
        return self.response


def test_khaya_tts_uses_subscription_key_and_published_contract() -> None:
    client = FakeClient(FakeResponse(content=make_wav()))
    provider = KhayaTtsProvider("https://translation-api.ghananlp.org", "k" * 32, speaker="female", client=client)
    result = provider.synthesize(job())
    request = client.posts[0]
    assert result.provider == "khaya"
    assert result.duration_ms == 100
    assert request["url"] == "https://translation-api.ghananlp.org/tts/v1/tts"
    assert request["headers"]["Ocp-Apim-Subscription-Key"] == "k" * 32
    assert request["json"] == {"text": "Onyame nhyira mo nyinaa", "language": "twi", "speaker_id": "female"}


def test_khaya_tts_accepts_riff_audio_even_when_gateway_content_type_is_generic() -> None:
    client = FakeClient(FakeResponse(content=make_wav(), content_type="application/octet-stream"))
    result = KhayaTtsProvider("https://translation-api.ghananlp.org", "k" * 32, client=client).synthesize(job(target_language_code="ewe"))
    assert result.content_type == "audio/wav"


def test_khaya_tts_rejects_html_200_response() -> None:
    client = FakeClient(FakeResponse(content=b"<html>gateway</html>", content_type="text/html"))
    provider = KhayaTtsProvider("https://translation-api.ghananlp.org", "k" * 32, client=client)
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job())
    assert error.value.code == "invalid_audio_content_type"


def test_khaya_voice_profile_requires_khaya_speaker_binding() -> None:
    client = FakeClient(FakeResponse(content=make_wav()))
    provider = KhayaTtsProvider("https://translation-api.ghananlp.org", "k" * 32, client=client)
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job(voice_profile_id="profile", voice_provider="google", provider_voice_id="female"))
    assert error.value.code == "voice_provider_mismatch"
    assert client.posts == []
