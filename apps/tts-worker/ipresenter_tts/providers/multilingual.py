from __future__ import annotations

from ..languages import normalize_language
from ..models import SynthesisResult, TtsJob
from .base import TtsProvider, TtsProviderError


class MultilingualTtsProvider:
    """Routes one live service across generic/personalized language providers.

    Generic English/French use their configured Google voices. Generic Twi/Akan
    and Ewe use the Ghana voice provider. A consent-bound personalized profile
    always routes by its stored provider, while Google personalized voices still
    use the target-language Google client.
    """

    name = "multilingual"

    def __init__(
        self,
        google_english: TtsProvider,
        google_french: TtsProvider,
        ghana: TtsProvider,
    ) -> None:
        self._google_english = google_english
        self._google_french = google_french
        self._ghana = ghana

    def ready(self) -> bool:
        # One unavailable language provider must not stop other audience languages.
        return any(
            provider.ready()
            for provider in (self._google_english, self._google_french, self._ghana)
        )

    def synthesize(self, job: TtsJob) -> SynthesisResult:
        language = normalize_language(job.target_language_code)

        if job.voice_profile_id:
            if job.voice_provider == "ghananlp":
                return self._ghana.synthesize(job)
            if job.voice_provider == "google":
                return self._google_for(language).synthesize(job)
            raise TtsProviderError("voice_provider_mismatch")

        if language in {"ak", "ee"}:
            return self._ghana.synthesize(job)
        return self._google_for(language).synthesize(job)

    def _google_for(self, language: str) -> TtsProvider:
        if language == "en":
            return self._google_english
        if language == "fr":
            return self._google_french
        raise TtsProviderError("unsupported_language")
