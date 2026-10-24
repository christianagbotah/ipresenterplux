from __future__ import annotations

import pytest

from ipresenter_tts.models import SynthesisResult, TtsJob
from ipresenter_tts.providers.base import TtsProviderError
from ipresenter_tts.providers.multilingual import MultilingualTtsProvider


class FakeProvider:
    def __init__(self, name: str, ready: bool = True) -> None:
        self.name = name
        self._ready = ready
        self.jobs: list[TtsJob] = []

    def ready(self) -> bool:
        return self._ready

    def synthesize(self, job: TtsJob) -> SynthesisResult:
        self.jobs.append(job)
        return SynthesisResult(audio=b"RIFFfake", content_type="audio/wav", duration_ms=100, provider=self.name)


def job(language: str, **changes) -> TtsJob:
    values = dict(
        id="11111111-1111-4111-8111-111111111111",
        lease_token="22222222-2222-4222-8222-222222222222",
        service_id="33333333-3333-4333-8333-333333333333",
        organization_id="44444444-4444-4444-8444-444444444444",
        source_text="Interpret this",
        source_text_hash="a" * 64,
        target_language_code=language,
        voice_profile_id=None,
        voice_provider=None,
        provider_voice_id=None,
        attempts=1,
    )
    values.update(changes)
    return TtsJob(**values)


def router() -> tuple[MultilingualTtsProvider, FakeProvider, FakeProvider, FakeProvider]:
    en = FakeProvider("google-en")
    fr = FakeProvider("google-fr")
    gh = FakeProvider("ghananlp")
    return MultilingualTtsProvider(en, fr, gh), en, fr, gh


def test_generic_english_routes_to_google_english_voice() -> None:
    provider, en, fr, gh = router()
    result = provider.synthesize(job("english"))
    assert result.provider == "google-en"
    assert len(en.jobs) == 1 and not fr.jobs and not gh.jobs


def test_generic_french_routes_to_google_french_voice() -> None:
    provider, en, fr, gh = router()
    result = provider.synthesize(job("fr"))
    assert result.provider == "google-fr"
    assert len(fr.jobs) == 1 and not en.jobs and not gh.jobs


@pytest.mark.parametrize("language", ["ak", "twi", "ee", "ewe"])
def test_generic_ghana_languages_route_to_ghana_provider(language: str) -> None:
    provider, en, fr, gh = router()
    result = provider.synthesize(job(language))
    assert result.provider == "ghananlp"
    assert len(gh.jobs) == 1 and not en.jobs and not fr.jobs


def test_personalized_ghana_voice_routes_by_bound_provider() -> None:
    provider, en, fr, gh = router()
    provider.synthesize(job("fr", voice_profile_id="profile", voice_provider="ghananlp", provider_voice_id="consented-1"))
    assert len(gh.jobs) == 1 and not en.jobs and not fr.jobs


def test_personalized_google_voice_still_routes_by_language() -> None:
    provider, en, fr, gh = router()
    provider.synthesize(job("fr", voice_profile_id="profile", voice_provider="google", provider_voice_id="fr-FR-Custom"))
    assert len(fr.jobs) == 1 and not en.jobs and not gh.jobs


def test_unknown_personalized_provider_fails_closed() -> None:
    provider, en, fr, gh = router()
    with pytest.raises(TtsProviderError) as error:
        provider.synthesize(job("ewe", voice_profile_id="profile", voice_provider="other", provider_voice_id="voice"))
    assert error.value.code == "voice_provider_mismatch"
    assert not en.jobs and not fr.jobs and not gh.jobs


def test_readiness_allows_partial_provider_availability() -> None:
    en = FakeProvider("google-en", ready=False)
    fr = FakeProvider("google-fr", ready=True)
    gh = FakeProvider("ghananlp", ready=False)
    provider = MultilingualTtsProvider(en, fr, gh)
    assert provider.ready() is True
