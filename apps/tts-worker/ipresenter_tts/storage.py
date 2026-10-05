from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

from .models import StoredAsset, SynthesisResult, TtsJob
from .providers.base import TtsProviderError

MAX_AUDIO_BYTES = 10 * 1024 * 1024
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
CONTENT_TYPES = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
}


def _valid_magic(extension: str, payload: bytes) -> bool:
    if extension == "wav":
        return len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WAVE"
    if extension == "ogg":
        return payload.startswith(b"OggS")
    if extension == "mp3":
        return payload.startswith(b"ID3") or (
            len(payload) >= 2 and payload[0] == 0xFF and (payload[1] & 0xE0) == 0xE0
        )
    return False


class AudioStore:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._tts_dir = (self._root / "tts").resolve()
        if self._root not in self._tts_dir.parents:
            raise ValueError("TTS storage path escapes configured root")

    def store(self, job: TtsJob, result: SynthesisResult) -> StoredAsset:
        if not UUID.fullmatch(job.id) or not UUID.fullmatch(job.lease_token):
            raise TtsProviderError("invalid_job_or_lease_id")
        extension = CONTENT_TYPES.get(result.content_type)
        if extension is None:
            raise TtsProviderError("unsupported_audio_format")
        if result.duration_ms <= 0 or result.duration_ms > 600_000:
            raise TtsProviderError("invalid_audio_duration")
        if not result.audio or len(result.audio) > MAX_AUDIO_BYTES:
            raise TtsProviderError("invalid_audio_size")
        if not _valid_magic(extension, result.audio):
            raise TtsProviderError("invalid_audio_payload")

        job_dir = (self._tts_dir / job.id).resolve()
        if self._tts_dir not in job_dir.parents:
            raise TtsProviderError("invalid_audio_path")
        job_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(job_dir, 0o700)

        final_path = (job_dir / f"{job.lease_token}.{extension}").resolve()
        if job_dir not in final_path.parents:
            raise TtsProviderError("invalid_audio_path")

        fd, temp_name = tempfile.mkstemp(prefix=f".{job.lease_token}.", suffix=".tmp", dir=job_dir)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(result.audio)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp_name, 0o600)
            os.replace(temp_name, final_path)
            os.chmod(final_path, 0o600)
        except Exception:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise

        return StoredAsset(
            asset_key=f"tts/{job.id}/{job.lease_token}.{extension}",
            content_type=result.content_type,
            duration_ms=result.duration_ms,
            absolute_path=str(final_path),
        )

    @staticmethod
    def remove(asset: StoredAsset) -> None:
        try:
            Path(asset.absolute_path).unlink()
        except FileNotFoundError:
            pass
