from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TtsJob:
    id: str
    lease_token: str
    service_id: str
    organization_id: str
    source_text: str
    source_text_hash: str
    target_language_code: str
    voice_profile_id: str | None
    voice_provider: str | None
    provider_voice_id: str | None
    attempts: int


@dataclass(frozen=True, slots=True)
class SynthesisResult:
    audio: bytes
    content_type: str
    duration_ms: int
    provider: str


@dataclass(frozen=True, slots=True)
class StoredAsset:
    asset_key: str
    content_type: str
    duration_ms: int
    absolute_path: str
