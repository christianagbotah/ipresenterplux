from __future__ import annotations

from .errors import TtsProviderError


_ALIASES = {
    "en": "en",
    "english": "en",
    "fr": "fr",
    "french": "fr",
    "ak": "ak",
    "tw": "ak",
    "twi": "ak",
    "akan": "ak",
    "ee": "ee",
    "ewe": "ee",
}


def normalize_language(code: str) -> str:
    normalized = (code or "").strip().lower()
    canonical = _ALIASES.get(normalized)
    if canonical is None:
        raise TtsProviderError("unsupported_language")
    return canonical
