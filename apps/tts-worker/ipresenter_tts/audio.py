from __future__ import annotations

from .errors import TtsProviderError


def wav_duration_ms(audio: bytes) -> int:
    if len(audio) < 12 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise TtsProviderError("invalid_audio_response")
    offset = 12
    byte_rate: int | None = None
    data_size: int | None = None
    while offset + 8 <= len(audio):
        chunk = audio[offset:offset + 4]
        size = int.from_bytes(audio[offset + 4:offset + 8], "little")
        start = offset + 8
        end = start + size
        if end > len(audio):
            raise TtsProviderError("invalid_audio_response")
        if chunk == b"fmt " and size >= 12:
            byte_rate = int.from_bytes(audio[start + 8:start + 12], "little")
        elif chunk == b"data":
            data_size = size
        offset = end + (size & 1)
    if not byte_rate or data_size is None or data_size <= 0:
        raise TtsProviderError("invalid_audio_response")
    duration = round((data_size / byte_rate) * 1000)
    if duration <= 0 or duration > 600_000:
        raise TtsProviderError("invalid_audio_duration")
    return duration
