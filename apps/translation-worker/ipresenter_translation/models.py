from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TranslationJob:
    id: str
    lease_token: str
    service_id: str
    source_text: str
    source_language: str | None
    target_language_code: str
    channel_mode: str
    attempts: int


@dataclass(frozen=True, slots=True)
class TranslationResult:
    text: str
    provider: str
