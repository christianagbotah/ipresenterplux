# Competitive UX Phase 6 — Audience Language & Service Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen iPresenterPlux's moat by making audience language choice, translated text/audio, operator awareness, and post-service memory work as one coherent flow without burdening Sunday operators.

**Architecture:** Extend the existing public audience service payload and translation/TTS jobs rather than creating another audience backend. Audience clients select a language locally, the server exposes available channel readiness and current translated artifacts, Cockpit consumes aggregate demand/health as concise recommendations/attention, and Archive stores service-level language/automation summaries.

**Tech Stack:** Next.js/React/TypeScript, PostgreSQL, Redis realtime, existing translation/TTS worker contracts, PWA/WebRTC audience surface.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md`

## Global Constraints

- Audience users never receive operator/admin controls.
- Language selection may differ from the projected Bible version/language.
- Personal audience preferences stay client-local unless a future authenticated audience profile explicitly opts in.
- Voice synthesis continues to obey existing consent/governance rules.
- Local Program remains functional when Internet/audience translation services degrade.
- Healthy translation systems recede; operator UI surfaces only demand, impact, and actionable failures.

## Review Focus

- A language may have captions ready while translated audio is unavailable; UI must represent partial readiness accurately.
- Switching audience language must not alter projector Program language.
- Translation/TTS job lag must not freeze current Scripture/video playback.
- Listener counts must not leak personally identifying audience data.
- Service archive must remain valid when some language channels had no listeners or failed jobs.

---

### Task 1: Extend public audience live payload with channel readiness

**Files:**
- Modify: `apps/control/src/lib/public-audience-service.ts`
- Modify: `apps/control/src/app/api/v1/audience/service/[id]/route.ts`
- Modify: `apps/control/src/components/audience/LiveAudience.tsx`
- Modify: `apps/control/src/components/audience/LiveTranslatedAudio.tsx`
- Create: `apps/control/scripts/audience-language-readiness-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Extend `PublicAudienceLanguage` with `textStatus: "ready"|"pending"|"unavailable"`, `audioStatus: "ready"|"pending"|"unavailable"`, and safe current artifact ids/URLs only when authorized for public playback.
- Projector/current Program Scripture remains independent of selected audience language.

- [ ] **Step 1: Write failing tests for independent projector/audience language, partial text/audio readiness, no private worker/provider details, and empty-language fallback.**
- [ ] **Step 2: Extend service loader/API from existing translation/TTS job state.**
- [ ] **Step 3: Update audience UI language selector and readiness copy without blocking Program video/scripture.**
- [ ] **Step 4: Run audience live-state, translation, TTS and new readiness tests; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(audience): expose language channel readiness"`.

---

### Task 2: Preserve audience language preference locally and reconnect safely

**Files:**
- Modify: `apps/control/src/components/audience/LiveAudience.tsx`
- Modify: `apps/control/src/components/audience/AudienceRealtimeRefresh.tsx`
- Create: `apps/control/src/lib/audience-language-preference.ts`
- Modify: `apps/control/scripts/audience-language-readiness-selftest.mjs`

**Interfaces:**
- Preference key is scoped to organization/service audience identity and stores only selected language/channel id; no person identifier.
- Missing/removed language falls back to original/default channel.
- Reconnect never auto-plays newly available audio when browser autoplay policy forbids it; user gesture remains authoritative.

- [ ] **Step 1: Add failing local preference/removal/reconnect/autoplay tests.**
- [ ] **Step 2: Implement small storage helper and reconnect-safe selection.**
- [ ] **Step 3: Run PWA/audience tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(audience): remember listener language safely"`.

---

### Task 3: Feed aggregate audience demand into Cockpit intelligence

**Files:**
- Modify: `apps/control/src/lib/cockpit/view-model.ts`
- Modify: `apps/control/src/lib/cockpit/predictive-next.ts`
- Modify: `apps/control/src/lib/cockpit/attention.ts`
- Modify: `apps/control/src/components/cockpit/NowRail.tsx`
- Modify: `apps/control/scripts/cockpit-predictive-next-selftest.mjs`
- Modify: `apps/control/scripts/cockpit-attention-selftest.mjs`

**Interfaces:**
- Cockpit gets aggregate listener counts per enabled language/mode, never audience identity.
- Recommendation example: `French listeners connected · translated audio is ready`.
- Attention example only when users are affected: `French audio unavailable · 14 listeners affected · captions still available`.

- [ ] **Step 1: Write failing tests for aggregate-only projection, demand-ranked recommendation, partial-degradation copy, and zero-listener suppression.**
- [ ] **Step 2: Implement view-model projection + Predictive Next/attention mapping.**
- [ ] **Step 3: Run Cockpit predictive-next/attention/acceptance tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): surface audience language demand"`.

---

### Task 4: Record service intelligence summary in Archive

**Files:**
- Modify: `apps/control/src/lib/archive.ts`
- Modify: `apps/control/src/app/archive/page.tsx` if summary is rendered there
- Create or modify: `apps/control/scripts/archive-selftest.mjs`

**Interfaces:**
- Archive summary includes Scriptures used, automatic Scripture live takes count, detected-vs-presented count, language listener peaks, translation/TTS incidents, and stream incidents using existing audited/service data.
- No raw audience identity or voice credentials are stored in the summary.

- [ ] **Step 1: Add failing archive tests for empty/full summaries, Auto Scripture Live counts, language peaks, and privacy exclusions.**
- [ ] **Step 2: Extend archive projection from existing service/audit/language/translation rows.**
- [ ] **Step 3: Run archive, Scripture automation and audience tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(archive): remember service language and automation outcomes"`.

---

### Task 5: End-to-end multilingual service UAT

**Files:**
- Modify only if required by test wiring: `.github/workflows/control-ci.yml`
- Add evidence under existing QA/evidence convention used by the repository.

**Interfaces:**
- One simulated service covers original audio, projected Scripture, independent French/Twi audience selection, text/audio readiness changes, stream degradation, Auto Scripture Live event, reconnect, and archive summary.

- [ ] **Step 1: Add deterministic acceptance harness that verifies no audience-language action changes Program language/state.**
- [ ] **Step 2: Run translation/TTS/audience/Cockpit/archive suites, lint and build.**
- [ ] **Step 3: Run full Control Portal CI and relevant worker/Edge contract tests.**
- [ ] **Step 4: Field-UAT with at least two audience phones on different languages and one operator device; verify degraded audio falls back to text without affecting local Program.**
- [ ] **Step 5: Record the service in Archive and verify the summary contains aggregates only.**
