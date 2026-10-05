from .base import TranslationProvider, TranslationProviderError
from .disabled import DisabledProvider
from .google import GoogleCloudProvider


def create_provider(name: str) -> TranslationProvider:
    if name == "google":
        return GoogleCloudProvider()
    return DisabledProvider()


__all__ = [
    "TranslationProvider",
    "TranslationProviderError",
    "DisabledProvider",
    "GoogleCloudProvider",
    "create_provider",
]
