from .base import TtsProvider, TtsProviderError
from .disabled import DisabledProvider


def create_provider(name: str) -> TtsProvider:
    del name
    return DisabledProvider()


__all__ = ["TtsProvider", "TtsProviderError", "DisabledProvider", "create_provider"]
