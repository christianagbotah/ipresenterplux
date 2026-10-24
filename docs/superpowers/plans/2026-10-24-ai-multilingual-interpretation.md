# AI Multilingual Interpretation Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete first-class English, French, Twi/Akan and Ewe live interpretation with consent-bound voice synthesis and resilient audience delivery.

**Architecture:** Extend the already-green translation/TTS job pipeline rather than replacing it. Normalize supported language aliases before provider calls; keep Google text translation and existing Google TTS, add a GhanaNLP-compatible HTTPS TTS provider, and reuse the existing consent/binding and audience queue contracts.

**Tech Stack:** Python TTS/translation workers, Next.js/TypeScript Control Plane, PostgreSQL job contracts, React Native audience client, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-ai-multilingual-interpretation-design.md`

## Global Constraints
- Edge remains physical Preview/Program authority.
- Existing guarded Scripture automation remains the only AI live-output exception.
- Supported canonical languages are exactly `en`, `fr`, `ak`, `ee` for this release gate.
- Personalized voice requires existing consented voice-profile binding; no live automatic enrollment.
- Provider credentials and voice samples never enter browser/mobile/desktop payloads.
- Text translation remains usable when TTS is unavailable.
- Local presentation remains usable when all cloud AI workers are unavailable.

## Review Focus
- Unsupported/ambiguous language aliases must fail closed rather than route to a wrong voice.
- Provider URL must reject insecure remote HTTP endpoints.
- Personalized voice/provider mismatch must fail before network synthesis.
- Malformed/oversized provider audio must never be published to the audience queue.
- A failed audio segment must not block later audience segments.

---

### Task 1: Pin language normalization and GhanaNLP provider contracts

**Files:**
- Create: `apps/tts-worker/ipresenter_tts/languages.py`
- Create: `apps/tts-worker/tests/test_languages.py`
- Create: `apps/tts-worker/tests/test_ghananlp.py`
- Modify: `apps/tts-worker/tests/test_config.py`

**Interfaces:**
- Produces `normalize_language(code: str) -> str` returning `en|fr|ak|ee` or raising `TtsProviderError("unsupported_language")`.
- Pins `ghananlp` settings and provider behavior before production implementation.

- [ ] Write failing tests for language aliases and unsupported-language rejection.
- [ ] Write failing config tests for `IPRESENTERPLUX_TTS_PROVIDER=ghananlp`, HTTPS endpoint validation, optional generic voice id, and token source.
- [ ] Write failing provider tests for Twi/Ewe generic synthesis, consent-bound provider voice routing, mismatched provider rejection, and malformed audio rejection.
- [ ] Push RED test commit and confirm TTS Worker CI fails for missing implementation.

### Task 2: Implement language normalization and GhanaNLP TTS provider

**Files:**
- Create: `apps/tts-worker/ipresenter_tts/languages.py`
- Create: `apps/tts-worker/ipresenter_tts/providers/ghananlp.py`
- Modify: `apps/tts-worker/ipresenter_tts/config.py`
- Modify: `apps/tts-worker/ipresenter_tts/providers/__init__.py`
- Modify: `apps/tts-worker/ipresenter_tts/providers/google.py`
- Modify: `apps/tts-worker/ipresenter_tts/runner.py`
- Modify: `apps/tts-worker/README.md`
- Modify: `deploy/systemd/ipresenterplux-tts.service`

**Interfaces:**
- Consumes Task 1 contracts.
- Produces selectable `ghananlp` provider with bounded HTTPS calls and canonical language routing.

- [ ] Implement exact alias normalization.
- [ ] Use normalization in Google TTS while preserving explicit BCP-47 Google voice validation for supported language voices.
- [ ] Add GhanaNLP settings: endpoint, bearer token/token-file, optional generic voice id, request timeout inherited from worker provider timeout.
- [ ] Add GhanaNLP provider request/response validation and voice-profile routing.
- [ ] Wire provider selection in runner/provider factory.
- [ ] Run TTS unit tests GREEN and update deployment docs/service environment examples without committing secrets.

### Task 3: Normalize translation targets and expose four-language readiness

**Files:**
- Modify: `apps/translation-worker/ipresenter_translation/providers/google.py`
- Create or modify worker language utility/tests under `apps/translation-worker/tests/`
- Modify Control language-channel validation only if it currently accepts ambiguous aliases without canonicalization.
- Modify relevant Control selftests for audience readiness/language channels.

**Interfaces:**
- Produces canonical `en|fr|ak|ee` provider target codes while preserving source-language behavior.

- [ ] Write RED tests for English/French/Twi/Ewe aliases and unsupported values.
- [ ] Implement normalization at the worker/provider boundary.
- [ ] Verify Google provider receives `ak` for Twi and `ee` for Ewe.
- [ ] Verify text-only channels remain ready when TTS is unavailable.

### Task 4: Close audience and AI Director readiness behavior

**Files:**
- Modify only if needed after tests: audience readiness projection/UI and AI Director workspace/selftest.
- Verify: `apps/mobile/TranslatedAudioPlayer.tsx` existing retry/skip behavior.

**Interfaces:**
- Consumes translation/TTS worker statuses and existing audience queue.
- Produces accurate text-ready versus voice-ready operator state for all four languages.

- [ ] Add contract tests for four-language demand/readiness.
- [ ] Pin that failed synthesis never hides successful translated text.
- [ ] Pin that later audio queue segments remain playable after a failed segment.
- [ ] Implement only gaps revealed by the tests.

### Task 5: Whole-stack verification and delivery

**Files:** no feature files unless verification reveals a defect.

- [ ] Run TTS worker tests, Translation Worker CI, Control Portal CI, Edge Agent CI where touched.
- [ ] Run AI Director, audience readiness, voice consent/binding, speech synthesis and translation selftests in CI/test DB—not against production DB.
- [ ] Run `git diff --check` and compare against `feat/ai-director-field-integration-v2`.
- [ ] Open a draft PR stacked on `feat/ai-director-field-integration-v2`.
- [ ] Keep provider enablement off until real credentials and consented voice profiles are configured and physical Twi/Ewe/French audience UAT passes.
