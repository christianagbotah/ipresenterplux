from .base import TtsProvider, TtsProviderError
from .disabled import DisabledProvider
from .ghananlp import GhanaNlpTtsProvider
from .google import GoogleCloudTtsProvider


def create_provider(
    name: str,
    google_voice_name: str | None = None,
    *,
    ghananlp_url: str | None = None,
    ghananlp_token: str | None = None,
    ghananlp_voice_id: str | None = None,
    provider_timeout_seconds: float = 15.0,
) -> TtsProvider:
    if name == "google":
        return GoogleCloudTtsProvider(google_voice_name)
    if name == "ghananlp":
        if not ghananlp_url or not ghananlp_token:
            raise ValueError("GhanaNLP TTS provider configuration is incomplete")
        return GhanaNlpTtsProvider(
            ghananlp_url,
            ghananlp_token,
            ghananlp_voice_id,
            timeout_seconds=provider_timeout_seconds,
        )
    return DisabledProvider()


__all__ = [
    "TtsProvider",
    "TtsProviderError",
    "DisabledProvider",
    "GoogleCloudTtsProvider",
    "GhanaNlpTtsProvider",
    "create_provider",
]
