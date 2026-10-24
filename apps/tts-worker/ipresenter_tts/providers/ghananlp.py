from __future__ import annotations

from typing import Any

import httpx

from ..audio import wav_duration_ms
from ..languages import normalize_language
from ..models import SynthesisResult, TtsJob
from .base import TtsProviderError


_MAX_AUDIO_BYTES = 20 * 1024 * 1024
_ALLOWED_WAV_TYPES = {"audio/wav", "audio/x-wav", "audio/wave"}


class GhanaNlpTtsProvider:
    name = "ghananlp"

    def __init__(
        self,
        base_url: str,
        token: str,
        generic_voice_id: str | None = None,
        *,
        timeout_seconds: float = 15.0,
        client: Any | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._generic_voice_id = generic_voice_id
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client(timeout=timeout_seconds, follow_redirects=False)

    def _headers(self, accept: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": accept,
        }

    def ready(self) -> bool:
        try:
            response = self._client.get(
                f"{self._base_url}/health",
                headers=self._headers("application/json"),
                timeout=self._timeout_seconds,
            )
            return 200 <= int(response.status_code) < 300
        except Exception:
            return False

    def synthesize(self, job: TtsJob) -> SynthesisResult:
        language = normalize_language(job.target_language_code)
        if job.voice_profile_id:
            if job.voice_provider != self.name or not job.provider_voice_id:
                raise TtsProviderError("voice_provider_mismatch")
            voice_id = job.provider_voice_id
        else:
            if not self._generic_voice_id:
                raise TtsProviderError("voice_not_configured")
            voice_id = self._generic_voice_id

        try:
            response = self._client.post(
                f"{self._base_url}/v1/synthesize",
                headers=self._headers("audio/wav"),
                json={"text": job.source_text, "language": language, "voiceId": voice_id},
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise TtsProviderError("provider_request_failed") from exc
        except Exception as exc:
            raise TtsProviderError("provider_request_failed") from exc

        if not 200 <= int(response.status_code) < 300:
            raise TtsProviderError("provider_request_failed")
        content_type = str(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if content_type not in _ALLOWED_WAV_TYPES:
            raise TtsProviderError("invalid_audio_content_type")
        audio = bytes(response.content)
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
