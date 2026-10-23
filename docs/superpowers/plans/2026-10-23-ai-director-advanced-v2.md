# AI Director Advanced V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the proven AI branches into the current desktop field line and expose live sermon, predictive-next, audience language demand, and post-service memory through AI Director V2.

**Architecture:** Reuse the existing Cockpit, Scripture automation, ASR, translation/TTS and service-memory contracts. AI Director is a bounded read/projection surface plus existing settings mutation; it never gains direct Program authority. Desktop only surfaces AI health and opens cloud AI workspaces.

**Tech Stack:** Next.js/React/TypeScript/PostgreSQL, Node selftests, Avalonia/.NET desktop shell.

**Spec:** `docs/superpowers/specs/2026-10-23-ai-director-advanced-v2-design.md`

## Global Constraints
- Physical Preview/Program truth remains Edge-owned.
- AI Director must not directly mutate Program.
- Existing guarded Scripture auto-live policy remains the only AI live-output exception.
- Queries must be organization/service scoped and bounded.
- No provider secrets in browser or desktop payloads.
- Presentation must continue if AI, translation, TTS or Internet is unavailable.

## Review Focus
- Stale transcript rows must not look current.
- Predictive-next must retain existing freshness/tenant filtering.
- Audience language counts must not cross organization/service scope.
- Ended-service memory failures must never block service completion.
- Desktop AI links must use the configured Control Plane and not alter Program.

---

### Task 1: Integrate audience intelligence and service memory

**Files:** Existing commits from `feat/service-intelligence-memory-v2` not present in the field branch.

**Interfaces:**
- Consumes existing `services`, `transcript_segments`, language/audience, archive and Cockpit contracts.
- Produces audience language session/readiness projections and service-memory contracts/workspaces.

- [ ] Verify the eight source commits are not already ancestors of this branch.
- [ ] Cherry-pick `90cc072`, `8e5e3ff`, `54bbdb4`, `638d962`, `88e6bf8`, `61ddcd3`, `8ad6a3c`, `27424a5` in order.
- [ ] Resolve conflicts in favor of the current field branch for newer navigation/desktop/runtime behavior while retaining the AI feature contracts.
- [ ] Run the branch-provided audience/service-intelligence selftests and Control TypeScript build/lint gates that cover touched files.
- [ ] Commit any conflict-resolution fixes separately.

### Task 2: Add advanced AI Director projection

**Files:**
- Modify: `apps/control/src/lib/ai-director.ts`
- Modify: `apps/control/scripts/ai-director-selftest.mjs`
- Reuse: `apps/control/src/lib/cockpit/predictive-next.ts`

**Interfaces:**
- Produces `liveTranscript`, `smartNext`, `languageDemand`, and `memory` fields on `AIDirectorState`.

- [ ] Extend `ai-director-selftest.mjs` first with DB fixtures/assertions for transcript, smart-next, language demand and memory state.
- [ ] Run `pnpm test:ai-director` and confirm RED for missing fields.
- [ ] Implement bounded service/org-scoped queries and reuse `projectPredictiveNext`.
- [ ] Treat transcript older than 120 seconds as stale in the UI-facing projection.
- [ ] Run `pnpm test:ai-director` and related predictive-next/audience/service-memory tests GREEN.

### Task 3: Build AI Director V2 workspace

**Files:**
- Modify: `apps/control/src/components/ai-director/AIDirectorWorkspace.tsx`
- Modify: `apps/control/scripts/ai-director-selftest.mjs`

**Interfaces:**
- Consumes Task 2 state fields.
- Produces visible Live Sermon, Smart Next, Language Demand, Memory and Health panels.

- [ ] Add source-contract assertions first for `Live Sermon`, `Smart Next`, `Language Demand`, `Service Memory`, and absence of direct Program mutation controls.
- [ ] Run `pnpm test:ai-director` RED.
- [ ] Implement the responsive workspace using existing design tokens/components and links to `/cockpit`, `/scripture`, `/translations`, `/archive`.
- [ ] Run `pnpm test:ai-director` GREEN.

### Task 4: Surface AI Director from desktop Operator

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

**Interfaces:**
- Consumes existing mic/ASR snapshot truth and `CloudUri`/`LinkButton`.
- Produces Operator links to AI Director and Translations without changing local Program commands.

- [ ] Add failing layout/source-contract tests for `AI Director` and `Translations` links beside mic/ASR/voice status.
- [ ] Implement a compact AI actions row in the persistent Operator header/details area.
- [ ] Verify desktop tests through Windows/macOS CI because the VPS has no .NET SDK.

### Task 5: Whole-branch verification and delivery

**Files:** no feature files unless verification finds defects.

- [ ] Run Control selftests for AI Director, predictive-next, Scripture automation, Live Assist, audience intelligence and service memory.
- [ ] Run `pnpm build` (or the repository's authoritative Control CI build if local build is blocked by environment).
- [ ] Run `git diff --check` and inspect branch diff against `fix/operator-field-uat-interaction`.
- [ ] Push branch and verify Control CI and Edge Agent CI on the exact head.
- [ ] Keep the feature branch/PR unmerged until field UAT confirms AI status and desktop links on the production laptop.