from __future__ import annotations

from typing import Any

import httpx

from ..models import TranslationJob, TranslationResult
from .base import TranslationProviderError


_TARGETS = {
    "tw": "tw",
    "twi": "tw",
    "ak": "tw",
    "akan": "tw",
    "ee": "ee",
    "ewe": "ee",
    "gaa": "gaa",
    "ga": "gaa",
}

_ENGLISH = {"en", "eng", "english"}


def _translation_pair(source: str | None, target: str) -> str:
    source_code = (source or "en").strip().lower()
    target_code = (target or "").strip().lower()
    if source_code not in _ENGLISH:
        raise TranslationProviderError("unsupported_language")
    if target_code in _ENGLISH:
        return "en-en"
    mapped = _TARGETS.get(target_code)
    if mapped is None:
        raise TranslationProviderError("unsupported_language")
    return f"en-{mapped}"


def _translated_text(response: Any) -> str:
    try:
        body = response.json()
    except Exception as exc:
        raise TranslationProviderError("invalid_response") from exc
    if isinstance(body, str):
        text = body.strip()
    elif isinstance(body, dict):
        text = str(
            body.get("translatedText")
            or body.get("translation")
            or body.get("text")
            or body.get("description")
            or ""
        ).strip()
    else:
        text = ""
    if not text:
        raise TranslationProviderError("empty_translation")
    return text


class KhayaTranslationProvider:
    name = "khaya"

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout_seconds: float = 15.0,
        client: Any | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client(timeout=timeout_seconds, follow_redirects=False)

    def ready(self) -> bool:
        return bool(self._base_url and self._token)

    def translate(self, job: TranslationJob) -> TranslationResult:
        pair = _translation_pair(job.source_language, job.target_language_code)
        if pair == "en-en":
            return TranslationResult(text=job.source_text, provider=self.name)

        try:
            response = self._client.post(
                f"{self._base_url}/v1/translate",
                headers={
                    "Ocp-Apim-Subscription-Key": self._token,
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                },
                json={"in": job.source_text, "lang": pair},
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise TranslationProviderError("provider_request_failed") from exc
        except Exception as exc:
            raise TranslationProviderError("provider_request_failed") from exc

        status = int(response.status_code)
        if status in {401, 403}:
            raise TranslationProviderError("provider_auth_failed")
        if status == 429:
            raise TranslationProviderError("provider_rate_limited")
        if not 200 <= status < 300:
            raise TranslationProviderError("provider_request_failed")
        return TranslationResult(text=_translated_text(response), provider=self.name)
