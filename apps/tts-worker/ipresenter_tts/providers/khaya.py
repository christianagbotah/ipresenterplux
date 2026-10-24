from __future__ import annotations

from typing import Any

import httpx

from ..audio import wav_duration_ms
from ..models import SynthesisResult, TtsJob
from .base import TtsProviderError


_MAX_AUDIO_BYTES = 20 * 1024 * 1024
_SPEAKERS = {"female", "male_low", "male_high"}
_LANGUAGE_CODES = {
    "en": "eng",
    "eng": "eng",
    "english": "eng",
    "fr": "fra",
    "fra": "fra",
    "french": "fra",
    "ak": "twi",
    "tw": "twi",
    "twi": "twi",
    "akan": "twi",
    "ee": "ewe",
    "ewe": "ewe",
    "gaa": "gaa",
    "ga": "gaa",
}


def _khaya_language(code: str) -> str:
    normalized = (code or "").strip().lower()
    language = _LANGUAGE_CODES.get(normalized)
    if language is None:
        raise TtsProviderError("unsupported_language")
    return language


def _speaker_for(job: TtsJob, generic_speaker: str | None) -> str | None:
    if job.voice_profile_id:
        if job.voice_provider != "khaya" or not job.provider_voice_id:
            raise TtsProviderError("voice_provider_mismatch")
        if job.provider_voice_id not in _SPEAKERS:
            raise TtsProviderError("voice_provider_mismatch")
        return job.provider_voice_id
    return generic_speaker


class KhayaTtsProvider:
    name = "khaya"

    def __init__(
        self,
        base_url: str,
        token: str,
        speaker: str | None = None,
        *,
        timeout_seconds: float = 15.0,
        client: Any | None = None,
    ) -> None:
        if speaker is not None and speaker not in _SPEAKERS:
            raise ValueError("Khaya speaker is invalid")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._speaker = speaker
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client(timeout=timeout_seconds, follow_redirects=False)

    def ready(self) -> bool:
        return bool(self._base_url and self._token)

    def synthesize(self, job: TtsJob) -> SynthesisResult:
        payload: dict[str, str] = {
            "text": job.source_text,
            "language": _khaya_language(job.target_language_code),
        }
        speaker = _speaker_for(job, self._speaker)
        if speaker is not None:
            payload["speaker_id"] = speaker

        try:
            response = self._client.post(
                f"{self._base_url}/tts/v1/tts",
                headers={
                    "Ocp-Apim-Subscription-Key": self._token,
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "Accept": "audio/wav",
                },
                json=payload,
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise TtsProviderError("provider_request_failed") from exc
        except Exception as exc:
            raise TtsProviderError("provider_request_failed") from exc

        status = int(response.status_code)
        if status in {401, 403}:
            raise TtsProviderError("provider_auth_failed")
        if status == 429:
            raise TtsProviderError("provider_rate_limited")
        if not 200 <= status < 300:
            raise TtsProviderError("provider_request_failed")

        audio = bytes(response.content)
        content_type = str(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if not (content_type.startswith("audio/") or audio.startswith(b"RIFF")):
            raise TtsProviderError("invalid_audio_content_type")
        if not audio:
            raise TtsProviderError("empty_audio")
        if len(audio) > _MAX_AUDIO_BYTES:
            raise TtsProviderError("audio_too_large")
        return SynthesisResult(
            audio=audio,
            content_type="audio/wav",
            duration_ms=wav_duration_ms(audio),
            provider=self.name,
        )
