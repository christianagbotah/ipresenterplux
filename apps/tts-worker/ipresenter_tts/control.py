from __future__ import annotations

from typing import Any

import httpx

from . import __version__
from .config import Settings
from .models import StoredAsset, TtsJob


class CompletionRejected(RuntimeError):
    pass


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

    def claim(self) -> list[TtsJob]:
        response = self._client.post(
            "/api/v1/tts/worker/claim",
            json={
                "workerId": self._settings.worker_id,
                "leaseSeconds": self._settings.lease_seconds,
            },
        )
        response.raise_for_status()
        payload = response.json()
        jobs = payload.get("jobs") if isinstance(payload, dict) else None
        if not isinstance(jobs, list):
            raise ValueError("Control plane returned an invalid TTS job response")
        return [self._parse_job(item) for item in jobs]

    def complete(self, job: TtsJob, asset: StoredAsset, provider: str) -> None:
        response = self._client.patch(
            f"/api/v1/tts/worker/jobs/{job.id}",
            json={
                "outcome": "succeeded",
                "leaseToken": job.lease_token,
                "provider": provider,
                "audioAssetKey": asset.asset_key,
                "audioContentType": asset.content_type,
                "durationMs": asset.duration_ms,
            },
        )
        if response.status_code in {400, 409}:
            raise CompletionRejected(f"TTS completion rejected with HTTP {response.status_code}")
        response.raise_for_status()

    def fail(self, job: TtsJob, error_code: str) -> None:
        response = self._client.patch(
            f"/api/v1/tts/worker/jobs/{job.id}",
            json={"outcome": "failed", "leaseToken": job.lease_token, "errorCode": error_code},
        )
        response.raise_for_status()

    def heartbeat(
        self,
        state: str,
        claimed: int,
        completed: int,
        failed: int,
        error_code: str | None,
    ) -> None:
        response = self._client.post(
            "/api/v1/tts/worker/heartbeat",
            json={
                "workerId": self._settings.worker_id,
                "provider": self._settings.provider,
                "state": state,
                "softwareVersion": __version__,
                "claimed": claimed,
                "completed": completed,
                "failed": failed,
                "errorCode": error_code,
            },
        )
        response.raise_for_status()

    @staticmethod
    def _parse_job(value: Any) -> TtsJob:
        if not isinstance(value, dict):
            raise ValueError("TTS job must be an object")
        return TtsJob(
            id=str(value["id"]),
            lease_token=str(value["lease_token"]),
            service_id=str(value["service_id"]),
            organization_id=str(value["organization_id"]),
            source_text=str(value["source_text"]),
            source_text_hash=str(value["source_text_hash"]),
            target_language_code=str(value["target_language_code"]),
            voice_profile_id=str(value["voice_profile_id"]) if value.get("voice_profile_id") else None,
            voice_provider=str(value["voice_provider"]) if value.get("voice_provider") else None,
            provider_voice_id=str(value["provider_voice_id"]) if value.get("provider_voice_id") else None,
            attempts=int(value["attempts"]),
        )
