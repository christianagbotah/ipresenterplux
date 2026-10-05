from __future__ import annotations

from typing import Protocol

from .engine import Transcription


class SpeakerDiarizer(Protocol):
    name: str

    @property
    def ready(self) -> bool: ...

    async def identify_pcm16(self, audio_bytes: bytes, transcription: Transcription) -> str | None: ...


class DisabledDiarizer:
    name = "disabled"

    @property
    def ready(self) -> bool:
        return False

    async def identify_pcm16(self, audio_bytes: bytes, transcription: Transcription) -> str | None:
        del audio_bytes, transcription
        return None


def create_diarizer(name: str) -> SpeakerDiarizer:
    if name == "disabled":
        return DisabledDiarizer()
    raise ValueError(f"Unsupported diarization provider: {name}")
