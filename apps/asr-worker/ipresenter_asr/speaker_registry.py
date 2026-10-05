from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Callable, Sequence


@dataclass(slots=True)
class _Speaker:
    speaker_id: str
    centroid: list[float]
    samples: int


@dataclass(slots=True)
class _Session:
    speakers: list[_Speaker]
    last_seen: float


class SessionSpeakerRegistry:
    """Assigns stable, service-scoped speaker IDs from normalized embeddings."""

    def __init__(
        self,
        similarity_threshold: float = 0.72,
        max_speakers: int = 12,
        session_ttl_seconds: float = 6 * 60 * 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not 0.0 < similarity_threshold < 1.0:
            raise ValueError("similarity_threshold must be between 0 and 1")
        if max_speakers < 1 or max_speakers > 64:
            raise ValueError("max_speakers must be between 1 and 64")
        if session_ttl_seconds <= 0:
            raise ValueError("session_ttl_seconds must be positive")
        self._threshold = similarity_threshold
        self._max_speakers = max_speakers
        self._ttl = session_ttl_seconds
        self._clock = clock
        self._sessions: dict[str, _Session] = {}

    def assign(self, session_id: str, embedding: Sequence[float]) -> str | None:
        session_key = session_id.strip().lower()
        vector = self._normalize(embedding)
        if not session_key or vector is None:
            return None

        now = self._clock()
        self._expire(now)
        session = self._sessions.get(session_key)
        if session is None:
            session = _Session([], now)
            self._sessions[session_key] = session
        session.last_seen = now

        best: _Speaker | None = None
        best_score = -1.0
        for speaker in session.speakers:
            score = self._dot(speaker.centroid, vector)
            if score > best_score:
                best = speaker
                best_score = score

        if best is not None and best_score >= self._threshold:
            self._update(best, vector)
            return best.speaker_id

        if len(session.speakers) >= self._max_speakers:
            return None

        speaker = _Speaker(f"speaker-{len(session.speakers) + 1:03d}", vector, 1)
        session.speakers.append(speaker)
        return speaker.speaker_id

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id.strip().lower(), None)

    def _expire(self, now: float) -> None:
        expired = [key for key, session in self._sessions.items() if now - session.last_seen >= self._ttl]
        for key in expired:
            del self._sessions[key]

    @staticmethod
    def _normalize(values: Sequence[float]) -> list[float] | None:
        vector = [float(value) for value in values]
        if not vector or not all(math.isfinite(value) for value in vector):
            return None
        norm = math.sqrt(sum(value * value for value in vector))
        if norm <= 1e-12:
            return None
        return [value / norm for value in vector]

    @staticmethod
    def _dot(left: Sequence[float], right: Sequence[float]) -> float:
        if len(left) != len(right):
            return -1.0
        return sum(a * b for a, b in zip(left, right, strict=True))

    @staticmethod
    def _update(speaker: _Speaker, vector: Sequence[float]) -> None:
        # Cap historical weight so the centroid can adapt gradually to microphone/room changes.
        weight = min(speaker.samples, 19)
        merged = [(old * weight + new) / (weight + 1) for old, new in zip(speaker.centroid, vector, strict=True)]
        normalized = SessionSpeakerRegistry._normalize(merged)
        if normalized is not None:
            speaker.centroid = normalized
        speaker.samples += 1
