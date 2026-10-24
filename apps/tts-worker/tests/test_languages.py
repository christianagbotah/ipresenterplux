from __future__ import annotations

import pytest

from ipresenter_tts.languages import normalize_language
from ipresenter_tts.providers.base import TtsProviderError


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("en", "en"),
        ("ENGLISH", "en"),
        ("fr", "fr"),
        ("French", "fr"),
        ("ak", "ak"),
        ("tw", "ak"),
        ("Twi", "ak"),
        ("Akan", "ak"),
        ("ee", "ee"),
        ("Ewe", "ee"),
    ],
)
def test_supported_interpretation_language_aliases_are_canonical(raw: str, expected: str) -> None:
    assert normalize_language(raw) == expected


@pytest.mark.parametrize("raw", ["", "gaa", "de", "twi-gh", "unknown"])
def test_unsupported_interpretation_language_fails_closed(raw: str) -> None:
    with pytest.raises(TtsProviderError) as error:
        normalize_language(raw)
    assert error.value.code == "unsupported_language"
