from .base import TtsProvider, TtsProviderError
from .disabled import DisabledProvider
from .ghananlp import GhanaNlpTtsProvider
from .google import GoogleCloudTtsProvider
from .multilingual import MultilingualTtsProvider


def create_provider(
    name: str,
    google_voice_name: str | None = None,
    *,
    google_voice_en: str | None = None,
    google_voice_fr: str | None = None,
    ghananlp_url: str | None = None,
    ghananlp_token: str | None = None,
    ghananlp_voice_id: str | None = None,
    provider_timeout_seconds: float = 15.0,
) -> TtsProvider:
    if name == "google":
        return GoogleCloudTtsProvider(google_voice_name)
    if name in {"ghananlp", "multilingual"}:
        if not ghananlp_url or not ghananlp_token:
            raise ValueError("GhanaNLP TTS provider configuration is incomplete")
        ghana = GhanaNlpTtsProvider(
            ghananlp_url,
            ghananlp_token,
            ghananlp_voice_id,
            timeout_seconds=provider_timeout_seconds,
        )
        if name == "ghananlp":
            return ghana
        if not google_voice_en or not google_voice_fr:
            raise ValueError("Multilingual TTS requires English and French Google voices")
        return MultilingualTtsProvider(
            GoogleCloudTtsProvider(google_voice_en),
            GoogleCloudTtsProvider(google_voice_fr),
            ghana,
        )
    return DisabledProvider()


__all__ = [
    "TtsProvider",
    "TtsProviderError",
    "DisabledProvider",
    "GoogleCloudTtsProvider",
    "GhanaNlpTtsProvider",
    "MultilingualTtsProvider",
    "create_provider",
]
