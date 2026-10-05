from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from ipresenter_asr.config import Settings
from ipresenter_asr.main import create_app


def settings(token: str | None = None) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        token=token,
        model="small",
        model_dir=Path("/definitely/not/a/model"),
        local_files_only=True,
        device="cpu",
        compute_type="int8",
        language=None,
        beam_size=3,
        max_audio_bytes=200_000,
    )


def test_health_does_not_load_model() -> None:
    with TestClient(create_app(settings())) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["modelLoaded"] is False


def test_transcribe_validates_contract_before_loading_model() -> None:
    with TestClient(create_app(settings())) as client:
        response = client.post(
            "/v1/transcribe",
            content=b"\x00\x00",
            headers={
                "Content-Type": "application/octet-stream",
                "X-IPresenter-Sample-Rate": "48000",
                "X-IPresenter-Audio-Format": "pcm_s16le_mono",
            },
        )
        assert response.status_code == 400


def test_token_protects_transcription() -> None:
    with TestClient(create_app(settings("worker-token"))) as client:
        headers = {
            "Content-Type": "application/octet-stream",
            "X-IPresenter-Sample-Rate": "16000",
            "X-IPresenter-Audio-Format": "pcm_s16le_mono",
        }
        response = client.post("/v1/transcribe", content=b"\x00\x00", headers=headers)
        assert response.status_code == 401


def test_health_reports_disabled_diarization() -> None:
    with TestClient(create_app(settings())) as client:
        payload = client.get("/health").json()
        assert payload["diarization"] == "disabled"
        assert payload["diarizationReady"] is False


def test_diarizer_speaker_id_is_returned_without_changing_asr_result() -> None:
    from ipresenter_asr.engine import Transcription

    class FakeEngine:
        loaded = True

        async def transcribe_pcm16(self, audio_bytes: bytes) -> Transcription:
            assert audio_bytes == b"\x00\x00\x00\x00"
            return Transcription(text="Welcome church", language="en", confidence=0.91)

    class FakeDiarizer:
        name = "fake"
        ready = True

        async def identify_pcm16(self, audio_bytes: bytes, transcription: Transcription) -> str | None:
            assert audio_bytes
            assert transcription.text == "Welcome church"
            return "speaker-pastor"

    with TestClient(create_app(settings(), engine=FakeEngine(), diarizer=FakeDiarizer())) as client:
        response = client.post(
            "/v1/transcribe",
            content=b"\x00\x00\x00\x00",
            headers={
                "Content-Type": "application/octet-stream",
                "X-IPresenter-Sample-Rate": "16000",
                "X-IPresenter-Audio-Format": "pcm_s16le_mono",
            },
        )
        assert response.status_code == 200
        assert response.json() == {
            "text": "Welcome church",
            "language": "en",
            "speakerId": "speaker-pastor",
            "confidence": 0.91,
        }
