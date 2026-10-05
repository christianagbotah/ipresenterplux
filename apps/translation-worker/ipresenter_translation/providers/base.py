from __future__ import annotations

from typing import Protocol

from ..models import TranslationJob, TranslationResult


class TranslationProviderError(RuntimeError):
    def __init__(self, code: str, message: str = "Translation provider failed") -> None:
        super().__init__(message)
        self.code = code


class TranslationProvider(Protocol):
    name: str

    def ready(self) -> bool: ...

    def translate(self, job: TranslationJob) -> TranslationResult: ...
