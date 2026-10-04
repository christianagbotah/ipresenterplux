from __future__ import annotations

import asyncio
import math
import threading
from dataclasses import dataclass
from typing import Any

from .config import Settings


class EngineUnavailableError(RuntimeError):
    """The configured local inference engine cannot currently serve requests."""


@dataclass(frozen=True, slots=True)
class Transcription:
    text: str
    language: str | None
    confidence: float | None


class WhisperEngine:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model: Any | None = None
        self._load_lock = threading.Lock()
        self._inference_lock = asyncio.Lock()
        self._last_error: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                self._last_error = "faster-whisper is not installed"
                raise EngineUnavailableError(
                    "Local Whisper support is not installed. Install the local-whisper extra."
                ) from exc

            try:
                self._model = WhisperModel(
                    self._settings.model,
                    device=self._settings.device,
                    compute_type=self._settings.compute_type,
                    download_root=str(self._settings.model_dir) if self._settings.model_dir else None,
                    local_files_only=self._settings.local_files_only,
                )
                self._last_error = None
                return self._model
            except Exception as exc:  # inference backends expose several runtime exception types
                self._last_error = f"{type(exc).__name__}: {exc}"
                raise EngineUnavailableError(
                    "The configured speech model is unavailable. Check the local model installation and device settings."
                ) from exc

    async def transcribe_pcm16(self, audio_bytes: bytes) -> Transcription:
        async with self._inference_lock:
            return await asyncio.to_thread(self._transcribe_sync, audio_bytes)

    def _transcribe_sync(self, audio_bytes: bytes) -> Transcription:
        try:
            import numpy as np
        except ImportError as exc:
            self._last_error = "numpy is not installed"
            raise EngineUnavailableError(
                "Local Whisper support is incomplete. Install the local-whisper extra."
            ) from exc

        model = self._load_model()
        audio = np.frombuffer(audio_bytes, dtype="<i2").astype(np.float32) / 32768.0
        segments, info = model.transcribe(
            audio,
            language=self._settings.language,
            beam_size=self._settings.beam_size,
            vad_filter=False,
            condition_on_previous_text=False,
        )

        text_parts: list[str] = []
        confidence_weight = 0.0
        confidence_total = 0.0
        for segment in segments:
            text = str(segment.text).strip()
            if text:
                text_parts.append(text)
            duration = max(0.001, float(segment.end) - float(segment.start))
            avg_logprob = getattr(segment, "avg_logprob", None)
            if avg_logprob is not None and math.isfinite(float(avg_logprob)):
                confidence_total += min(1.0, max(0.0, math.exp(float(avg_logprob)))) * duration
                confidence_weight += duration

        confidence = None if confidence_weight == 0 else confidence_total / confidence_weight
        language = getattr(info, "language", None)
        return Transcription(
            text=" ".join(text_parts).strip(),
            language=str(language) if language else None,
            confidence=confidence,
        )
