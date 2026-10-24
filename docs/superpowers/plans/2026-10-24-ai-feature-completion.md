# AI Feature Completion Implementation Plan

**Goal:** Finish software-side AI operational correctness and recovery so only provider credentials and physical church UAT remain.

**Spec:** `docs/superpowers/specs/2026-10-24-ai-feature-completion-design.md`

## Global constraints
- Edge remains physical Preview/Program authority.
- No provider secrets or voice samples reach clients.
- Personalized voice requires existing valid consent/binding.
- Text remains usable when voice synthesis fails.
- Existing `gaa` text-translation compatibility is preserved while `en|fr|ak|ee` are the primary release-gate languages.

### Task 1: Split text and voice readiness
**Files:** `apps/control/src/lib/audience-readiness.ts`, `apps/control/scripts/audience-readiness-selftest.mjs`, Audience Studio, Live Audience, AI Director workspace/selftest.
- [x] RED: pin text/voice facets, including synthesis failure with text ready and all four primary language examples.
- [x] GREEN: add facet projection while preserving overall compatibility.
- [x] Surface both facets in operator/public AI language UI.
- [x] Run audience + AI Director contract tests and lint.

### Task 2: Add safe terminal AI recovery
**Files:** new `apps/control/src/lib/translation-recovery.ts`; new retry routes under translation jobs; `TranslationDesk.tsx`; new selftest; package/CI hook.
- [x] RED: terminal translation retry and synthesis retry contracts, RBAC/entitlement/consent invariants.
- [x] GREEN: implement transactional retry helpers and audited authenticated routes.
- [x] Add Retry translation / Retry audio controls only when terminal failure is visible.
- [x] Run recovery, translation worker, speech synthesis, voice consent/binding tests.

### Task 3: Make web interpreted audio continue after failures
**Files:** `LiveTranslatedAudio.tsx`, audience readiness/acceptance selftest or extracted playback helper.
- [x] RED: pin bounded retry then cursor advance/continue contract.
- [x] GREEN: implement two retries per segment, then skip failed asset and continue queue.
- [x] Keep pause/start semantics and no busy retry loop.
- [x] Verify mobile parity remains intact.

### Task 4: Add whole-chain AI completion gate
**Files:** new `apps/control/scripts/ai-feature-completion-selftest.mjs`, `package.json`, `.github/workflows/control-ci.yml`.
- [x] RED/source-contract first, then DB-backed CI path.
- [x] Prove transcript ingest + Scripture recommendation + four-language jobs + readiness degradation/recovery + audience projection + service memory.
- [x] Assert no direct Program authority is added.

### Task 5: Whole-stack verification
- [x] Run Control AI/audience/recovery suites, production build, Translation Worker tests, TTS Worker tests, `git diff --check`.
- [ ] Push the release branch only after local gates pass, then verify exact-head GitHub checks.
- [x] Do not enable external providers without credentials; leave physical Twi/Ewe/French audio quality as UAT gate.
