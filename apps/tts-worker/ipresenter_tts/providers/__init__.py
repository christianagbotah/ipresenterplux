from .base import TtsProvider, TtsProviderError
from .disabled import DisabledProvider
from .google import GoogleCloudTtsProvider


def create_provider(name: str, google_voice_name: str | None = None) -> TtsProvider:
    if name == "google":
        return GoogleCloudTtsProvider(google_voice_name)
    return DisabledProvider()


__all__ = [
    "TtsProvider",
    "TtsProviderError",
    "DisabledProvider",
    "GoogleCloudTtsProvider",
    "create_provider",
]
