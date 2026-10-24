from __future__ import annotations


class TtsProviderError(RuntimeError):
    def __init__(self, code: str, message: str = "TTS provider failed") -> None:
        super().__init__(message)
        self.code = code
