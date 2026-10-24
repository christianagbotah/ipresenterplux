from .base import TranslationProvider, TranslationProviderError
from .disabled import DisabledProvider
from .google import GoogleCloudProvider
from .khaya import KhayaTranslationProvider


def create_provider(
    name: str,
    *,
    khaya_base_url: str | None = None,
    khaya_token: str | None = None,
    provider_timeout_seconds: float = 15.0,
) -> TranslationProvider:
    if name == "google":
        return GoogleCloudProvider()
    if name == "khaya":
        if not khaya_base_url or not khaya_token:
            raise ValueError("Khaya translation provider configuration is incomplete")
        return KhayaTranslationProvider(
            khaya_base_url,
            khaya_token,
            timeout_seconds=provider_timeout_seconds,
        )
    return DisabledProvider()


__all__ = [
    "TranslationProvider",
    "TranslationProviderError",
    "DisabledProvider",
    "GoogleCloudProvider",
    "KhayaTranslationProvider",
    "create_provider",
]
