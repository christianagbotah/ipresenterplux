from __future__ import annotations

import pytest

from ipresenter_translation.models import TranslationJob
from ipresenter_translation.providers.base import TranslationProviderError
from ipresenter_translation.providers.google import GoogleCloudProvider, _target_language


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("en", "en"),
        ("English", "en"),
        ("fr", "fr"),
        ("French", "fr"),
        ("ak", "ak"),
        ("tw", "ak"),
        ("Twi", "ak"),
        ("Akan", "ak"),
        ("ee", "ee"),
        ("Ewe", "ee"),
        ("gaa", "gaa"),
    ],
)
def test_interpretation_language_aliases_are_canonical(raw: str, expected: str) -> None:
    assert _target_language(raw) == expected


@pytest.mark.parametrize("raw", ["", "de", "twi-gh", "unknown"])
def test_unsupported_target_language_fails_closed(raw: str) -> None:
    with pytest.raises(TranslationProviderError) as error:
        _target_language(raw)
    assert error.value.code == "unsupported_language"


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def translate(self, text: str, **kwargs):
        self.calls.append({"text": text, **kwargs})
        return {"translatedText": "translated"}


def job(target_language_code: str) -> TranslationJob:
    return TranslationJob(
        id="11111111-1111-4111-8111-111111111111",
        lease_token="22222222-2222-4222-8222-222222222222",
        service_id="33333333-3333-4333-8333-333333333333",
        source_text="Welcome to church",
        source_language="en",
        target_language_code=target_language_code,
        channel_mode="translation_audio",
        attempts=1,
    )


def test_twi_alias_reaches_google_as_akan() -> None:
    client = FakeClient()
    provider = GoogleCloudProvider()
    provider._get_client = lambda: client  # type: ignore[method-assign]
    provider.translate(job("twi"))
    assert client.calls[0]["target_language"] == "ak"


def test_ewe_name_reaches_google_as_ewe_code() -> None:
    client = FakeClient()
    provider = GoogleCloudProvider()
    provider._get_client = lambda: client  # type: ignore[method-assign]
    provider.translate(job("ewe"))
    assert client.calls[0]["target_language"] == "ee"


def test_seeded_ga_text_channel_remains_compatible() -> None:
    client = FakeClient()
    provider = GoogleCloudProvider()
    provider._get_client = lambda: client  # type: ignore[method-assign]
    provider.translate(job("gaa"))
    assert client.calls[0]["target_language"] == "gaa"
