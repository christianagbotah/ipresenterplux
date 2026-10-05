from __future__ import annotations

from ipresenter_asr.speaker_registry import SessionSpeakerRegistry


def test_similar_embeddings_stay_stable_within_session() -> None:
    registry = SessionSpeakerRegistry(similarity_threshold=0.8)
    first = registry.assign("service-a", [1.0, 0.0, 0.0])
    second = registry.assign("service-a", [0.99, 0.05, 0.0])
    assert first == "speaker-001"
    assert second == first


def test_distinct_embeddings_create_distinct_speakers() -> None:
    registry = SessionSpeakerRegistry(similarity_threshold=0.8)
    assert registry.assign("service-a", [1.0, 0.0]) == "speaker-001"
    assert registry.assign("service-a", [0.0, 1.0]) == "speaker-002"


def test_sessions_are_isolated() -> None:
    registry = SessionSpeakerRegistry(similarity_threshold=0.8)
    assert registry.assign("service-a", [1.0, 0.0]) == "speaker-001"
    assert registry.assign("service-b", [0.0, 1.0]) == "speaker-001"


def test_capacity_does_not_force_bad_match() -> None:
    registry = SessionSpeakerRegistry(similarity_threshold=0.8, max_speakers=1)
    assert registry.assign("service-a", [1.0, 0.0]) == "speaker-001"
    assert registry.assign("service-a", [0.0, 1.0]) is None


def test_expired_session_gets_fresh_identity_space() -> None:
    now = [0.0]
    registry = SessionSpeakerRegistry(session_ttl_seconds=10, clock=lambda: now[0])
    assert registry.assign("service-a", [1.0, 0.0]) == "speaker-001"
    now[0] = 11.0
    assert registry.assign("service-a", [0.0, 1.0]) == "speaker-001"


def test_invalid_embedding_is_rejected() -> None:
    registry = SessionSpeakerRegistry()
    assert registry.assign("service-a", []) is None
    assert registry.assign("service-a", [0.0, 0.0]) is None
    assert registry.assign("", [1.0, 0.0]) is None
