from __future__ import annotations

import asyncio
import importlib.util
import threading
from pathlib import Path
from typing import Any, Protocol

from .config import Settings
from .engine import Transcription
from .speaker_registry import SessionSpeakerRegistry


class SpeakerDiarizer(Protocol):
    name: str

    @property
    def ready(self) -> bool: ...

    async def identify_pcm16(
        self,
        audio_bytes: bytes,
        transcription: Transcription,
        session_id: str | None,
    ) -> str | None: ...


class DisabledDiarizer:
    name = "disabled"

    @property
    def ready(self) -> bool:
        return False

    async def identify_pcm16(
        self,
        audio_bytes: bytes,
        transcription: Transcription,
        session_id: str | None,
    ) -> str | None:
        del audio_bytes, transcription, session_id
        return None


class SpeechBrainEcapaDiarizer:
    """Local ECAPA speaker embedding + service-scoped online clustering.

    Model files must already exist on disk. This adapter never downloads weights.
    """

    name = "speechbrain-ecapa"

    def __init__(self, settings: Settings) -> None:
        if settings.diarization_model_dir is None:
            raise ValueError("SpeechBrain diarization requires a local model directory")
        self._model_dir = settings.diarization_model_dir
        self._classifier: Any | None = None
        self._load_lock = threading.Lock()
        self._inference_lock = asyncio.Lock()
        self._registry = SessionSpeakerRegistry(
            similarity_threshold=settings.diarization_similarity_threshold,
            max_speakers=settings.diarization_max_speakers,
            session_ttl_seconds=settings.diarization_session_ttl_seconds,
        )

    @property
    def ready(self) -> bool:
        return (
            self._model_dir.is_dir()
            and (self._model_dir / "hyperparams.yaml").is_file()
            and importlib.util.find_spec("speechbrain") is not None
            and importlib.util.find_spec("torch") is not None
        )

    async def identify_pcm16(
        self,
        audio_bytes: bytes,
        transcription: Transcription,
        session_id: str | None,
    ) -> str | None:
        del transcription
        if not session_id or not self.ready or len(audio_bytes) < 3200:
            return None
        async with self._inference_lock:
            embedding = await asyncio.to_thread(self._embedding_sync, audio_bytes)
        return self._registry.assign(session_id, embedding)

    def _load_classifier(self) -> Any:
        if self._classifier is not None:
            return self._classifier
        with self._load_lock:
            if self._classifier is not None:
                return self._classifier
            try:
                from speechbrain.inference.speaker import EncoderClassifier
            except ImportError as exc:
                raise RuntimeError("SpeechBrain diarization support is not installed") from exc
            # `source` is a local filesystem directory. No model hub ID is accepted here.
            self._classifier = EncoderClassifier.from_hparams(
                source=str(self._model_dir),
                run_opts={"device": "cpu"},
            )
            return self._classifier

    def _embedding_sync(self, audio_bytes: bytes) -> list[float]:
        try:
            import numpy as np
            import torch
        except ImportError as exc:
            raise RuntimeError("SpeechBrain diarization dependencies are incomplete") from exc

        audio = np.frombuffer(audio_bytes, dtype="<i2").astype(np.float32) / 32768.0
        if audio.size == 0:
            return []
        waveform = torch.from_numpy(audio).unsqueeze(0)
        classifier = self._load_classifier()
        with torch.inference_mode():
            embedding = classifier.encode_batch(waveform)
        return embedding.detach().cpu().reshape(-1).to(dtype=torch.float32).tolist()


def create_diarizer(settings: Settings) -> SpeakerDiarizer:
    if settings.diarization_provider == "disabled":
        return DisabledDiarizer()
    if settings.diarization_provider == "speechbrain_ecapa":
        return SpeechBrainEcapaDiarizer(settings)
    raise ValueError(f"Unsupported diarization provider: {settings.diarization_provider}")
