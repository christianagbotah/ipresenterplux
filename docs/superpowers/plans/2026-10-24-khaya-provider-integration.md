# Khaya Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure Khaya translation and TTS providers and make them deployable with the user's server-side subscription key.

**Architecture:** Preserve the existing worker/provider boundaries. Add direct `httpx` Khaya adapters using the provider's published APIM contract, add secure file-based configuration, and keep all existing providers intact.

**Tech Stack:** Python 3.11, httpx, pytest, systemd.

**Spec:** `docs/superpowers/specs/2026-10-24-khaya-provider-integration-design.md`

## Global Constraints
- Never print, log, commit, or return the Khaya subscription key.
- Provider readiness must not consume metered Khaya calls.
- Existing Google and custom GhanaNLP providers must keep working.
- Unsupported or ambiguous languages fail closed.
- No automatic voice cloning or unrestricted Program authority is added.

## Review Focus
- Twi aliases must map to Khaya translation `tw` but Khaya TTS `twi`.
- Ewe must map to translation `ee` and TTS `ewe`.
- Ga must map to `gaa` for both services.
- French translation must fail closed under Khaya, while French TTS can use `fra`.
- Non-audio/HTML gateway responses must never be published as WAV.

---

### Task 1: Khaya Translation Provider

**Files:**
- Create: `apps/translation-worker/ipresenter_translation/providers/khaya.py`
- Create: `apps/translation-worker/tests/test_khaya.py`
- Modify: `apps/translation-worker/ipresenter_translation/config.py`
- Modify: `apps/translation-worker/ipresenter_translation/providers/__init__.py`
- Modify: `apps/translation-worker/ipresenter_translation/__main__.py`
- Modify: `deploy/systemd/ipresenterplux-translation.service`
- Modify: `apps/translation-worker/tests/test_config.py`
- Modify: `apps/translation-worker/tests/test_systemd_contract.py`

**Interfaces:**
- Produces: `KhayaTranslationProvider(base_url, token, timeout_seconds=...)` and secure Khaya settings.

- [ ] Write failing provider/config/systemd tests.
- [ ] Run focused tests and confirm failures are due to missing Khaya support.
- [ ] Implement the minimal provider and configuration wiring.
- [ ] Run focused and full translation-worker suites green.

### Task 2: Khaya TTS Provider

**Files:**
- Create: `apps/tts-worker/ipresenter_tts/providers/khaya.py`
- Create: `apps/tts-worker/tests/test_khaya.py`
- Modify: `apps/tts-worker/ipresenter_tts/config.py`
- Modify: `apps/tts-worker/ipresenter_tts/providers/__init__.py`
- Modify: `apps/tts-worker/ipresenter_tts/__main__.py`
- Modify: `apps/tts-worker/ipresenter_tts/languages.py`
- Modify: `apps/tts-worker/tests/test_config.py`
- Modify: `apps/tts-worker/tests/test_systemd_contract.py`

**Interfaces:**
- Consumes: same locked Khaya subscription-key file.
- Produces: `KhayaTtsProvider(base_url, token, speaker=None, timeout_seconds=...)`.

- [ ] Write failing provider/config/language tests.
- [ ] Run focused tests and confirm failures are due to missing Khaya support.
- [ ] Implement the minimal provider and configuration wiring.
- [ ] Run focused and full TTS-worker suites green.

### Task 3: Live Configuration and Verification

**Files:**
- Server-only: `.secrets/translation-provider.env`
- Server-only: `.secrets/tts-provider.env`

- [ ] Verify code diff contains no secret material.
- [ ] Configure translation for Khaya and restart only the translation worker.
- [ ] Verify service/status without exposing the key.
- [ ] Configure TTS for Khaya and restart only the TTS worker.
- [ ] If the subscription tier rejects TTS, restore TTS to disabled and report that entitlement gate; do not retry repeatedly.
- [ ] Run fresh worker suites and service health checks before any completion claim.
