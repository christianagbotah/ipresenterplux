from __future__ import annotations

from typing import Any

from ..models import SynthesisResult, TtsJob
from .base import TtsProviderError


def _language_code(code: str) -> str:
    normalized = code.strip()
    if not normalized:
        raise TtsProviderError("unsupported_language")
    if normalized.lower() == "fr":
        return "fr-FR"
    if "-" in normalized:
        return normalized
    raise TtsProviderError("unsupported_language")


def _wav_duration_ms(audio: bytes) -> int:
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


class GoogleCloudTtsProvider:
    name = "google"

    def __init__(self, default_voice_name: str | None = None) -> None:
        self._default_voice_name = default_voice_name
        self._client: Any | None = None
        self._module: Any | None = None
        self._load_error = False

    def _get_client(self) -> tuple[Any, Any]:
        if self._client is not None and self._module is not None:
            return self._client, self._module
        if self._load_error:
            raise TtsProviderError("provider_unavailable")
        try:
            from google.cloud import texttospeech
            self._module = texttospeech
            self._client = texttospeech.TextToSpeechClient()
            return self._client, self._module
        except Exception as exc:
            self._load_error = True
            raise TtsProviderError("provider_unavailable") from exc

    def ready(self) -> bool:
        try:
            self._get_client()
            return True
        except TtsProviderError:
            return False

    def synthesize(self, job: TtsJob) -> SynthesisResult:
        client, texttospeech = self._get_client()
        locale = _language_code(job.target_language_code)
        if job.voice_profile_id:
            if job.voice_provider != self.name or not job.provider_voice_id:
                raise TtsProviderError("voice_provider_mismatch")
            voice = texttospeech.VoiceSelectionParams(language_code=locale, name=job.provider_voice_id)
        else:
            if not self._default_voice_name:
                raise TtsProviderError("voice_not_configured")
            if not self._default_voice_name.lower().startswith(locale.lower() + "-"):
                raise TtsProviderError("voice_language_mismatch")
            voice = texttospeech.VoiceSelectionParams(
                language_code=locale,
                name=self._default_voice_name,
            )
        try:
            response = client.synthesize_speech(
                input=texttospeech.SynthesisInput(text=job.source_text),
                voice=voice,
                audio_config=texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.LINEAR16),
            )
        except TtsProviderError:
            raise
        except Exception as exc:
            raise TtsProviderError("provider_request_failed") from exc

        audio = bytes(getattr(response, "audio_content", b""))
        if not audio:
            raise TtsProviderError("empty_audio")
        return SynthesisResult(
            audio=audio,
            content_type="audio/wav",
            duration_ms=_wav_duration_ms(audio),
            provider=self.name,
        )
