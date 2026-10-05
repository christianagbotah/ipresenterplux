from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from ipresenter_tts.config import Settings
from ipresenter_tts.control import CompletionRejected, ControlPlaneClient
from ipresenter_tts.models import StoredAsset


def settings() -> Settings:
    return Settings(
        "http://127.0.0.1:3011",
        "t" * 48,
        "tts-test-worker",
        "disabled",
        1.0,
        45,
        5.0,
        2.0,
        Path("/tmp/tts-test-storage"),
    )


def job_payload() -> dict[str, object]:
    return {
        "id": "11111111-1111-4111-8111-111111111111",
        "lease_token": "22222222-2222-4222-8222-222222222222",
        "worker_id": "tts-test-worker",
        "organization_id": "33333333-3333-4333-8333-333333333333",
        "service_id": "44444444-4444-4444-8444-444444444444",
        "translation_job_id": "55555555-5555-4555-8555-555555555555",
        "language_channel_id": "66666666-6666-4666-8666-666666666666",
        "target_language_code": "fr",
        "source_text": "Bonjour",
        "source_text_hash": "a" * 64,
        "voice_profile_id": None,
        "voice_provider": None,
        "provider_voice_id": None,
        "attempts": 1,
        "lease_expires_at": "2026-10-05T09:00:00Z",
    }


def test_claim_contract_and_auth_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer " + "t" * 48
        assert request.url.path == "/api/v1/tts/worker/claim"
        payload = json.loads(request.content)
        assert payload == {"workerId": "tts-test-worker", "leaseSeconds": 45}
        return httpx.Response(200, json={"ok": True, "jobs": [job_payload()]})

    client = ControlPlaneClient(settings(), transport=httpx.MockTransport(handler))
    try:
        jobs = client.claim()
        assert len(jobs) == 1
        assert jobs[0].source_text == "Bonjour"
        assert jobs[0].target_language_code == "fr"
        assert jobs[0].voice_profile_id is None
    finally:
        client.close()


def test_complete_contract() -> None:
    asset = StoredAsset("tts/11111111-1111-4111-8111-111111111111.wav", "audio/wav", 900, "/tmp/a.wav")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/11111111-1111-4111-8111-111111111111")
        payload = json.loads(request.content)
        assert payload["outcome"] == "succeeded"
        assert payload["audioAssetKey"] == asset.asset_key
        assert payload["audioContentType"] == "audio/wav"
        assert payload["durationMs"] == 900
        assert payload["provider"] == "fake"
        return httpx.Response(200, json={"ok": True})

    client = ControlPlaneClient(settings(), transport=httpx.MockTransport(handler))
    try:
        job = client._parse_job(job_payload())
        client.complete(job, asset, "fake")
    finally:
        client.close()


def test_explicit_conflict_is_completion_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"ok": False, "error": "lease expired"})

    client = ControlPlaneClient(settings(), transport=httpx.MockTransport(handler))
    try:
        job = client._parse_job(job_payload())
        asset = StoredAsset("tts/11111111-1111-4111-8111-111111111111.wav", "audio/wav", 900, "/tmp/a.wav")
        with pytest.raises(CompletionRejected):
            client.complete(job, asset, "fake")
    finally:
        client.close()


def test_heartbeat_contract_is_payload_safe() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer " + "t" * 48
        assert request.url.path == "/api/v1/tts/worker/heartbeat"
        payload = json.loads(request.content)
        assert payload == {
            "workerId": "tts-test-worker",
            "provider": "disabled",
            "state": "disabled",
            "softwareVersion": "0.1.0",
            "claimed": 0,
            "completed": 0,
            "failed": 0,
            "errorCode": "provider_disabled",
        }
        body = request.content.decode()
        assert "source_text" not in body
        assert "audio" not in body.lower()
        return httpx.Response(200, json={"ok": True})

    client = ControlPlaneClient(settings(), transport=httpx.MockTransport(handler))
    try:
        client.heartbeat("disabled", 0, 0, 0, "provider_disabled")
    finally:
        client.close()
