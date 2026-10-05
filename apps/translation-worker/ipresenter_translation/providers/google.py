from __future__ import annotations

import html
from typing import Any

from ..models import TranslationJob, TranslationResult
from .base import TranslationProviderError


class GoogleCloudProvider:
    name = "google"

    def __init__(self) -> None:
        self._client: Any | None = None
        self._load_error = False

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if self._load_error:
            raise TranslationProviderError("provider_unavailable")
        try:
            from google.cloud import translate_v2 as translate
            self._client = translate.Client()
            return self._client
        except Exception as exc:
            self._load_error = True
            raise TranslationProviderError("provider_unavailable") from exc

    def ready(self) -> bool:
        try:
            self._get_client()
            return True
        except TranslationProviderError:
            return False

    def translate(self, job: TranslationJob) -> TranslationResult:
        try:
            response = self._get_client().translate(
                job.source_text,
                target_language=job.target_language_code,
                source_language=job.source_language or None,
                format_="text",
            )
        except TranslationProviderError:
            raise
        except Exception as exc:
            raise TranslationProviderError("provider_request_failed") from exc

        if not isinstance(response, dict):
            raise TranslationProviderError("invalid_response")
        text = html.unescape(str(response.get("translatedText") or "")).strip()
        if not text:
            raise TranslationProviderError("empty_translation")
        return TranslationResult(text=text, provider=self.name)
