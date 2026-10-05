from __future__ import annotations

import json

import httpx

from ipresenter_translation.config import Settings
from ipresenter_translation.control import ControlPlaneClient


def settings() -> Settings:
    return Settings("http://127.0.0.1:3011", "t" * 48, "test-worker", "google", 1.0, 45, 5.0, 2.0)


def test_claim_contract_and_auth_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer " + "t" * 48
        assert request.url.path == "/api/v1/translations/worker/claim"
        request_json = json.loads(request.content)
        assert request_json["limit"] == 1
        assert request_json["leaseSeconds"] == 45
        payload = {
            "ok": True,
            "jobs": [{
                "id": "job-1",
                "lease_token": "lease-1",
                "service_id": "service-1",
                "source_text": "Hello",
                "source_language": "en",
                "target_language_code": "fr",
                "channel_mode": "translation_audio",
                "attempts": 1,
            }],
        }
        return httpx.Response(200, json=payload)

    client = ControlPlaneClient(settings(), transport=httpx.MockTransport(handler))
    try:
        jobs = client.claim()
        assert len(jobs) == 1
        assert jobs[0].target_language_code == "fr"
        assert jobs[0].source_text == "Hello"
    finally:
        client.close()


def test_heartbeat_contract_is_payload_safe() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer " + "t" * 48
        assert request.url.path == "/api/v1/translations/worker/heartbeat"
        payload = json.loads(request.content)
        assert payload == {
            "workerId": "test-worker",
            "provider": "google",
            "state": "degraded",
            "softwareVersion": "0.1.0",
            "claimed": 1,
            "completed": 0,
            "failed": 1,
            "errorCode": "provider_timeout",
        }
        assert "source_text" not in request.content.decode()
        return httpx.Response(200, json={"ok": True})

    client = ControlPlaneClient(settings(), transport=httpx.MockTransport(handler))
    try:
        client.heartbeat("degraded", 1, 0, 1, "provider_timeout")
    finally:
        client.close()
