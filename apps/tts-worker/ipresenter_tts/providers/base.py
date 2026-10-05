from __future__ import annotations

from typing import Protocol

from ..models import SynthesisResult, TtsJob


class TtsProviderError(RuntimeError):
    def __init__(self, code: str, message: str = "TTS provider failed") -> None:
        super().__init__(message)
        self.code = code


class TtsProvider(Protocol):
    name: str

    def ready(self) -> bool: ...

    def synthesize(self, job: TtsJob) -> SynthesisResult: ...
