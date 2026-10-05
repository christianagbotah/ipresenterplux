from __future__ import annotations

from ..models import SynthesisResult, TtsJob
from .base import TtsProviderError


class DisabledProvider:
    name = "disabled"

    def ready(self) -> bool:
        return False

    def synthesize(self, job: TtsJob) -> SynthesisResult:
        del job
        raise TtsProviderError("provider_disabled", "TTS provider is disabled")
