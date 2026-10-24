from __future__ import annotations

import json

import pytest

from ipresenter_translation.models import TranslationJob
from ipresenter_translation.providers.base import TranslationProviderError
from ipresenter_translation.providers.khaya import KhayaTranslationProvider, _translation_pair


def job(target: str, source: str = "en") -> TranslationJob:
    return TranslationJob(
        id="11111111-1111-4111-8111-111111111111",
        lease_token="22222222-2222-4222-8222-222222222222",
        service_id="33333333-3333-4333-8333-333333333333",
        source_text="Welcome to church",
        source_language=source,
        target_language_code=target,
        channel_mode="translation_audio",
        attempts=1,
    )


@pytest.mark.parametrize(
    ("target", "expected"),
    [("twi", "en-tw"), ("ak", "en-tw"), ("ewe", "en-ee"), ("ee", "en-ee"), ("gaa", "en-gaa")],
)
def test_khaya_translation_pairs(target: str, expected: str) -> None:
    assert _translation_pair("en", target) == expected


def test_french_translation_fails_closed() -> None:
    with pytest.raises(TranslationProviderError) as error:
        _translation_pair("en", "fr")
    assert error.value.code == "unsupported_language"


class FakeResponse:
    def __init__(self, status_code: int = 200, body: object = "Akwaaba") -> None:
        self.status_code = status_code
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class FakeClient:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.posts: list[dict] = []

    def post(self, url: str, **kwargs):
        self.posts.append({"url": url, **kwargs})
        return self.response


def test_khaya_posts_subscription_key_and_published_contract() -> None:
    client = FakeClient(FakeResponse(body="Akwaaba"))
    provider = KhayaTranslationProvider("https://translation-api.ghananlp.org", "k" * 32, client=client)
    result = provider.translate(job("twi"))
    request = client.posts[0]
    assert result.text == "Akwaaba"
    assert result.provider == "khaya"
    assert request["url"] == "https://translation-api.ghananlp.org/v1/translate"
    assert request["headers"]["Ocp-Apim-Subscription-Key"] == "k" * 32
    assert request["json"] == {"in": "Welcome to church", "lang": "en-tw"}


def test_english_identity_does_not_consume_api_call() -> None:
    client = FakeClient(FakeResponse())
    provider = KhayaTranslationProvider("https://translation-api.ghananlp.org", "k" * 32, client=client)
    result = provider.translate(job("en"))
    assert result.text == "Welcome to church"
    assert client.posts == []


def test_khaya_auth_failure_is_classified() -> None:
    provider = KhayaTranslationProvider(
        "https://translation-api.ghananlp.org", "k" * 32, client=FakeClient(FakeResponse(401, {"message": "bad key"}))
    )
    with pytest.raises(TranslationProviderError) as error:
        provider.translate(job("ewe"))
    assert error.value.code == "provider_auth_failed"
