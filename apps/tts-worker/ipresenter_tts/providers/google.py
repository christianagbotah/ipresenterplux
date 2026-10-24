from __future__ import annotations

from typing import Any

from ..audio import wav_duration_ms
from ..languages import normalize_language
from ..models import SynthesisResult, TtsJob
from .base import TtsProviderError


def _language_code(code: str) -> str:
    normalized = code.strip()
    if not normalized:
        raise TtsProviderError("unsupported_language")
    if "-" in normalized:
        base = normalize_language(normalized.split("-", 1)[0])
        if base not in {"en", "fr"}:
            raise TtsProviderError("unsupported_language")
        return normalized
    canonical = normalize_language(normalized)
    if canonical == "en":
        return "en-US"
    if canonical == "fr":
        return "fr-FR"
    raise TtsProviderError("unsupported_language")


def _wav_duration_ms(audio: bytes) -> int:
    return wav_duration_ms(audio)


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
            duration_ms=wav_duration_ms(audio),
            provider=self.name,
        )
