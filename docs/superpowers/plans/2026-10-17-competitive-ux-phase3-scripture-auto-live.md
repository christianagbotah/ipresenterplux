# Competitive UX Phase 3 — Scripture Fast Path & Auto Scripture Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spoken Scripture presentation fast enough for live preaching and add an explicitly armed Auto Scripture Live mode that can promote trustworthy AI detections directly to Program without an operator click.

**Architecture:** Refactor the existing Scripture state route into one reusable state-transition service so manual TAKE and automation use the same DB, Edge command, audit and realtime path. Add additive organization/service automation policy fields, a deterministic policy evaluator in transcript ingest, explicit arm/disarm APIs, and persistent Cockpit/Scripture status; the default remains Manual and ambiguous/low-confidence detections fall back to Preview/Next.

**Tech Stack:** Next.js 16.3.8, TypeScript, PostgreSQL, Zod, local Bible library, existing ASR transcript ingest, Edge control commands, Redis realtime.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md`

## Global Constraints

- Modes are exactly `manual`, `auto_preview`, `auto_live`.
- `manual` is the default for every existing/new organization and service.
- Organization permission for Auto Scripture Live defaults OFF and is owner/admin controlled.
- Auto Scripture Live must be deliberately armed for the active service by `LIVE_OPERATOR_ROLES`.
- Product floors: explicit `reference` detection confidence >= 98; `quote` detection confidence >= 96. Organization/service thresholds may be raised, never lowered below those floors.
- Contextual commands (`next verse`, `continue`, etc.) never auto-live in v1.
- A transcript segment yielding more than one competing reference never auto-lives.
- Auto-live requires service status `live`, fresh/non-stale ingest, local Bible resolution, and at least one active Edge assigned to the service.
- The generic command layer does not gain unrestricted Program authority.
- Target: eligible finalized explicit reference -> queued Program update within 1.5s on supported local hardware; field-UAT measures this target.

## Review Focus

- Repeated mention of the already-live reference must not flicker/re-take Program.
- Two references in one utterance must not choose one silently for auto-live.
- Edge unavailable/unassigned must not leave DB claiming a successful automatic live take.
- Service end, organization disable, or explicit operator disarm must stop automation immediately.
- Quote confidence tops out at 96 today; threshold semantics must not accidentally make quote auto-live impossible unless an admin intentionally raises it above 96.

---

### Task 1: Add additive automation policy schema

**Files:**
- Create: `apps/control/db/043_scripture_automation_policy.sql`
- Create: `apps/control/scripts/scripture-automation-schema-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- `organizations.auto_scripture_live_enabled boolean NOT NULL DEFAULT false`.
- `services.scripture_automation_mode text NOT NULL DEFAULT 'manual' CHECK (...)`.
- `services.auto_scripture_reference_threshold numeric(5,2) NOT NULL DEFAULT 98.00 CHECK (>=98 AND <=100)`.
- `services.auto_scripture_quote_threshold numeric(5,2) NOT NULL DEFAULT 96.00 CHECK (>=96 AND <=100)`.
- `services.scripture_automation_armed_at timestamptz NULL`.
- `services.scripture_automation_armed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL`.
- `services.scripture_automation_suspended_reason text NULL`.

- [ ] **Step 1: Write failing schema test proving old rows become Manual/unarmed, floors are enforced, and foreign-key deletion clears the arming user without deleting service data.**
- [ ] **Step 2: Run schema test against isolated PostgreSQL; expect FAIL before migration.**
- [ ] **Step 3: Add migration with only additive columns/checks/FK.**
- [ ] **Step 4: Run migration twice + schema self-test; expect idempotent PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(control): add scripture automation policy"`.

---

### Task 2: Extract one Scripture state-transition authority service

**Files:**
- Create: `apps/control/src/lib/scripture-state.ts`
- Modify: `apps/control/src/app/api/v1/scriptures/[id]/state/route.ts`
- Modify: `apps/control/src/lib/edge-command-dispatch.ts`
- Create: `apps/control/scripts/scripture-state-authority-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- `export type ScriptureStateTarget = "detected" | "preview" | "live" | "dismissed"`.
- `export type ScriptureStateActor = { type: "operator"; userId: string } | { type: "automation"; userId: string; reason: "auto_scripture_live" }`.
- `export async function transitionScriptureState(client: PoolClient, input: { detectionId: string; targetState: ScriptureStateTarget; actor: ScriptureStateActor; source: string; requireEdgeForLive?: boolean }): Promise<{ scripture: { id: string; reference: string; state: string; detectedAt: string }; fromState: string; edgeCommandsQueued: number }>`.
- Extend `enqueueServiceEdgeCommand(...)` with optional `actorType: "operator" | "automation"` defaulting to `operator`; keep `issuedBy` as the arming/operator user id for traceability.
- Manual route performs auth/RBAC then delegates to `transitionScriptureState(...)`; it contains no duplicate Program mutation SQL afterward.

- [ ] **Step 1: Write failing authority tests proving manual and automation use the same `program.show` dispatch, same advisory lock/state exclusivity, and distinguish actor type in audit.**
- [ ] **Step 2: Add failing test: `requireEdgeForLive=true` with zero active assigned Edge returns conflict and does not persist `live`.**
- [ ] **Step 3: Extract service and simplify the route to authorization + delegation.**
- [ ] **Step 4: Run manual Scripture, state authority, Edge command, Cockpit stage tests; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "refactor(control): centralize scripture live authority"`.

---

### Task 3: Implement deterministic automation policy and suppression

**Files:**
- Create: `apps/control/src/lib/scripture-automation.ts`
- Modify: `apps/control/src/lib/transcript-ingest.ts`
- Create: `apps/control/scripts/scripture-automation-policy-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- `export type ScriptureAutomationDecision = { action: "detect" | "preview" | "live"; reason: string }`.
- `export function decideScriptureAutomation(input: { mode: "manual" | "auto_preview" | "auto_live"; organizationAutoLiveEnabled: boolean; serviceStatus: string; armed: boolean; detectionMethod: string; confidence: number; referenceThreshold: number; quoteThreshold: number; stale: boolean; competingMatches: number; alreadyLiveSameReference: boolean; activeEdgeCount: number; localBibleReady: boolean; asrConfidence: number | null }): ScriptureAutomationDecision`.
- If `asrConfidence` is present and `<0.85`, auto-live falls back to `preview` (when allowed) or `detect`; null does not by itself disqualify an otherwise trusted local ingest.
- Same reference already live within 10 seconds suppresses auto-live.
- `context` and `manual` detection methods never auto-live.
- Multiple matches in one segment never auto-live.

- [ ] **Step 1: Write table-driven failing tests for all mode/method/confidence/stale/competition/Edge/local-Bible cases.**
- [ ] **Step 2: Run policy test; expect FAIL.**
- [ ] **Step 3: Implement pure evaluator and minimal DB helpers for active Edge count / recent live reference.**
- [ ] **Step 4: Change transcript ingest to compute one decision per inserted detection; call `transitionScriptureState(... live ...)` only after insertion when decision is `live`.**
- [ ] **Step 5: Ensure recommendation state is `prepared` for Preview and reflects auto-live outcome without manufacturing a second Program path.**
- [ ] **Step 6: Run transcript, quote, automation, Cockpit recommendation tests; expect PASS.**
- [ ] **Step 7: Commit:** `git commit -m "feat(control): promote eligible scripture automatically"`.

---

### Task 4: Add organization permission + service arm/disarm APIs

**Files:**
- Create: `apps/control/src/app/api/v1/settings/scripture-automation/route.ts`
- Create: `apps/control/src/app/api/v1/services/[id]/scripture-automation/route.ts`
- Create: `apps/control/src/lib/scripture-automation-settings.ts`
- Create: `apps/control/scripts/scripture-automation-api-selftest.mjs`

**Interfaces:**
- Organization settings route: owner/admin only; body `{ autoScriptureLiveEnabled: boolean }`.
- Service route: `LIVE_OPERATOR_ROLES`; body `{ mode: "manual" | "auto_preview" | "auto_live"; armed: boolean; referenceThreshold?: number; quoteThreshold?: number }`.
- Arming `auto_live` requires organization permission ON, service `live`, active Edge assigned, and thresholds respecting product floors.
- Disarm clears `scripture_automation_armed_at/by` immediately.
- Disabling organization permission transactionally disarms any non-ended service in that organization.

- [ ] **Step 1: Write failing RBAC/tenant/state/floor/organization-disable tests.**
- [ ] **Step 2: Implement settings service and routes with audit events `scripture.automation.organization.changed` and `scripture.automation.service.changed`.**
- [ ] **Step 3: Update service-end route to clear arming fields and record disarm reason `service_ended`.**
- [ ] **Step 4: Run API, RBAC and service lifecycle tests; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(control): govern auto scripture live"`.

---

### Task 5: Add visible Manual / Auto Preview / Auto Scripture Live controls

**Files:**
- Modify: `apps/control/src/components/scripture/ScriptureWorkspace.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitHeader.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitMobile.tsx`
- Modify: `apps/control/src/lib/cockpit/contracts.ts`
- Modify: `apps/control/src/lib/cockpit/view-model.ts`
- Create: `apps/control/src/components/scripture/ScriptureAutomationControl.tsx`
- Create: `apps/control/src/app/settings/scripture-automation/page.tsx`
- Modify: `apps/control/src/app/settings/page.tsx`
- Create: `apps/control/scripts/scripture-auto-live-ui-selftest.mjs`

**Interfaces:**
- Persistent armed label exactly `AUTO SCRIPTURE LIVE ARMED` in Cockpit desktop/mobile whenever active.
- One action `Disarm` is always visible while armed and requires no modal confirmation.
- Switching into `auto_live` requires an explicit arm action; selecting the mode alone does not arm it.
- Low-confidence fallback copy states whether the item went to Preview or Next.

- [ ] **Step 1: Write failing UI tests for three modes, separate arm action, persistent armed label, one-action disarm, threshold floors, and disabled reasons.**
- [ ] **Step 2: Extend Cockpit view model with automation status derived from service policy.**
- [ ] **Step 3: Implement Scripture/Cockpit controls and owner/admin organization setting page.**
- [ ] **Step 4: Run Scripture UI, Cockpit shell/mobile, RBAC and accessibility/focus tests; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(control): expose auto scripture live controls"`.

---

### Task 6: Add circuit-breaker behavior, latency instrumentation, and field UAT

**Files:**
- Modify: `apps/control/src/lib/transcript-ingest.ts`
- Modify: `apps/control/src/lib/scripture-automation.ts`
- Create: `apps/control/src/lib/scripture-automation-telemetry.ts`
- Create: `apps/control/scripts/scripture-auto-live-acceptance-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Fatal auto-live prerequisites (`local_bible_unavailable`, `no_active_edge`, organization disabled, service not live) disarm or suspend with explicit reason; stale/low-confidence/ambiguous individual detections do not globally disarm.
- Audit auto-take details include detection id, reference, detection method, confidence, observedAt, decision reason, and queued Edge command count; never raw credentials/audio.
- Measure `finalizedRecognitionAt -> programCommandQueuedAt`; acceptance target <=1500ms on supported local field hardware.

- [ ] **Step 1: Write failing acceptance tests for fatal disarm, non-fatal fallback, duplicate suppression, competing reference suppression, and audit payload.**
- [ ] **Step 2: Implement telemetry/circuit-breaker hooks without blocking the synchronous eligible fast path on external services.**
- [ ] **Step 3: Run all Scripture/ASR/Cockpit/Edge authority tests, lint and production build.**
- [ ] **Step 4: Run full Control Portal CI.**
- [ ] **Step 5: Field-UAT at minimum: 50 explicit spoken references, repeated references, two-reference sentences, low ASR confidence, Edge disconnect, service end, emergency disarm, quote mode separately. Record false-take rate, missed eligible rate, and median/P95 recognition-to-command latency.**
- [ ] **Step 6: Ship Auto Scripture Live only after zero unsafe Program bypass findings in UAT.**
