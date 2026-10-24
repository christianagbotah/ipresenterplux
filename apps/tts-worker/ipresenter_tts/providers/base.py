from __future__ import annotations

from typing import Protocol

from ..errors import TtsProviderError
from ..models import SynthesisResult, TtsJob


class TtsProvider(Protocol):
    name: str

    def ready(self) -> bool: ...

    def synthesize(self, job: TtsJob) -> SynthesisResult: ...


__all__ = ["TtsProvider", "TtsProviderError"]
