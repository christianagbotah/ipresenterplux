from __future__ import annotations

from typing import Any

import httpx

from .config import Settings
from .models import TranslationJob


class ControlPlaneClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self._settings = settings
        self._client = httpx.Client(
            base_url=settings.control_url,
            timeout=settings.request_timeout_seconds,
            headers={"Authorization": f"Bearer {settings.worker_token}"},
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def claim(self) -> list[TranslationJob]:
        response = self._client.post(
            "/api/v1/translations/worker/claim",
            json={
                "workerId": self._settings.worker_id,
                "limit": 1,
                "leaseSeconds": self._settings.lease_seconds,
            },
        )
        response.raise_for_status()
        payload = response.json()
        jobs = payload.get("jobs") if isinstance(payload, dict) else None
        if not isinstance(jobs, list):
            raise ValueError("Control plane returned an invalid translation job response")
        return [self._parse_job(item) for item in jobs]

    def complete(self, job: TranslationJob, translated_text: str, provider: str) -> None:
        response = self._client.patch(
            f"/api/v1/translations/worker/jobs/{job.id}",
            json={
                "outcome": "succeeded",
                "leaseToken": job.lease_token,
                "translatedText": translated_text,
                "provider": provider,
            },
        )
        response.raise_for_status()

    def fail(self, job: TranslationJob, error_code: str) -> None:
        response = self._client.patch(
            f"/api/v1/translations/worker/jobs/{job.id}",
            json={"outcome": "failed", "leaseToken": job.lease_token, "errorCode": error_code},
        )
        response.raise_for_status()

    @staticmethod
    def _parse_job(value: Any) -> TranslationJob:
        if not isinstance(value, dict):
            raise ValueError("Translation job must be an object")
        return TranslationJob(
            id=str(value["id"]),
            lease_token=str(value["lease_token"]),
            service_id=str(value["service_id"]),
            source_text=str(value["source_text"]),
            source_language=str(value["source_language"]) if value.get("source_language") else None,
            target_language_code=str(value["target_language_code"]),
            channel_mode=str(value["channel_mode"]),
            attempts=int(value["attempts"]),
        )
