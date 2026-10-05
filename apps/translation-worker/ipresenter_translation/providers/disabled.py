from __future__ import annotations

from ..models import TranslationJob, TranslationResult
from .base import TranslationProviderError


class DisabledProvider:
    name = "disabled"

    def ready(self) -> bool:
        return False

    def translate(self, job: TranslationJob) -> TranslationResult:
        del job
        raise TranslationProviderError("provider_disabled", "Translation provider is disabled")
