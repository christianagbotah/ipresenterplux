from __future__ import annotations

import hmac
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from . import __version__
from .config import Settings, load_settings
from .engine import EngineUnavailableError, WhisperEngine
from .diarization import SpeakerDiarizer, create_diarizer


class HealthResponse(BaseModel):
    ok: bool = True
    product: str = "iPresenterPlux ASR Worker"
    version: str = __version__
    engine: str = "faster-whisper"
    model: str
    modelLoaded: bool
    localFilesOnly: bool
    device: str
    diarization: str
    diarizationReady: bool
    serverTime: str


class TranscriptionResponse(BaseModel):
    text: str
    language: str | None = None
    speakerId: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


def create_app(
    settings: Settings | None = None,
    engine: WhisperEngine | None = None,
    diarizer: SpeakerDiarizer | None = None,
) -> FastAPI:
    resolved = settings or load_settings()
    resolved_engine = engine or WhisperEngine(resolved)
    resolved_diarizer = diarizer or create_diarizer(resolved.diarization_provider)
    app = FastAPI(
        title="iPresenterPlux ASR Worker",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    def require_token(authorization: str | None) -> None:
        if not resolved.token:
            return
        expected = f"Bearer {resolved.token}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            model=resolved.model,
            modelLoaded=resolved_engine.loaded,
            localFilesOnly=resolved.local_files_only,
            device=resolved.device,
            diarization=resolved_diarizer.name,
            diarizationReady=resolved_diarizer.ready,
            serverTime=datetime.now(timezone.utc).isoformat(),
        )

    @app.post("/v1/transcribe", response_model=TranscriptionResponse)
    async def transcribe(
        request: Request,
        authorization: str | None = Header(default=None),
        x_ipresenter_sample_rate: str | None = Header(default=None),
        x_ipresenter_audio_format: str | None = Header(default=None),
        x_ipresenter_started_at: str | None = Header(default=None),
    ) -> TranscriptionResponse:
        require_token(authorization)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/octet-stream":
            raise HTTPException(status_code=415, detail="Expected application/octet-stream")
        if x_ipresenter_audio_format != "pcm_s16le_mono":
            raise HTTPException(status_code=400, detail="Expected pcm_s16le_mono audio")
        try:
            sample_rate = int(x_ipresenter_sample_rate or "")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid sample rate") from exc
        if sample_rate != resolved.sample_rate:
            raise HTTPException(status_code=400, detail=f"Expected {resolved.sample_rate} Hz audio")
        if x_ipresenter_started_at:
            try:
                datetime.fromisoformat(x_ipresenter_started_at.replace("Z", "+00:00"))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid audio start timestamp") from exc

        length = request.headers.get("content-length")
        if length:
            try:
                announced = int(length)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid content length") from exc
            if announced > resolved.max_audio_bytes:
                raise HTTPException(status_code=413, detail="Audio chunk is too large")

        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="Audio chunk is empty")
        if len(body) > resolved.max_audio_bytes:
            raise HTTPException(status_code=413, detail="Audio chunk is too large")
        if len(body) % 2:
            raise HTTPException(status_code=400, detail="PCM16 audio must contain whole samples")

        try:
            result = await resolved_engine.transcribe_pcm16(body)
        except EngineUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        speaker_id = None
        if result.text:
            speaker_id = await resolved_diarizer.identify_pcm16(body, result)

        return TranscriptionResponse(
            text=result.text,
            language=result.language,
            speakerId=speaker_id,
            confidence=result.confidence,
        )

    return app
