# Audience and Streaming Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give church operators a usable Audience Studio and eliminate stream sessions that can remain indefinitely in `starting` or `stopping`.

**Architecture:** Reuse the existing service realtime path, MediaMTX routing, `stream_session_authority`, destination truth model, and public audience components. Strengthen the stream state machine first, then build `/audience`, formalize `/live` states, and add a true program preview/readiness panel to `/streaming`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, PostgreSQL/pg, existing Edge command/realtime APIs, MediaMTX WebRTC/HLS, `qrcode` for local QR generation.

**Spec:** `docs/superpowers/specs/2026-10-07-audience-streaming-reliability-design.md`

## Global Constraints

- Only `starting`, `live`, and `stopping` are active stream states; only one active session per service.
- Ending a service must not leave an active stream session behind.
- Reconciliation is idempotent and uses bounded transitional-state age thresholds.
- Master transport, per-destination transport, and provider-confirmed social state remain separate truths.
- One destination/provider failure cannot terminate healthy destinations or local Program/recording.
- Public audience responses expose no tenant-internal data beyond the opaque service identifier already in the URL.
- Realtime is primary with bounded polling fallback; manual refresh must not be required.

## Review Focus

- Edge stop acknowledgement arriving after the service is ended must not resurrect or error an already-terminal stream; covered in Task 1 tests.
- A stale `starting` session with no router publisher must become `error`, while stale `stopping` becomes `ended`; covered in Task 1 tests.
- Ending a service while the publisher Edge is offline must still complete the service transition and terminalize DB stream state; covered in Task 2 tests.
- A valid but not-live audience URL must show a waiting state rather than “not found”; covered in Task 4 tests.
- Provider OAuth/API failure must never change a healthy RTMPS transport from live to failed; covered in Task 5 regression tests.

---

### Task 1: Close the stream-session lifecycle gaps

**Files:**
- Modify: `apps/control/src/lib/stream-session-authority.ts`
- Modify: `apps/control/scripts/stream-session-authority-selftest.mjs`

**Interfaces:**
- Extend `reconcileStreamCommandResult(client, result)` so successful `stream.stop` acknowledgement terminalizes the matching `stopping` session to `ended`, ends nonterminal destination rows, and revokes contribution grants.
- Produce: `reconcileStaleStreamSession(client, serviceId, options?) -> TransitionResult`, with initial thresholds `starting: 120s` and `stopping: 120s`; stale start => `error` with `stream_start_timeout`, stale stop => `ended` with reconciliation evidence.

- [ ] **Step 1: Add failing state-machine tests** for stop-success finalization, stale-start timeout, stale-stop finalization, repeated reconciliation idempotency, stale publisher command rejection, and terminal-session no-op.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:stream-session-authority`; expected FAIL on the new assertions.
- [ ] **Step 3: Implement stop-success terminalization** without changing successful `stream.start` semantics; start still requires router-ready evidence before `live`.
- [ ] **Step 4: Implement bounded stale-session reconciliation** using locked session rows and recorded machine-readable metrics/reasons.
- [ ] **Step 5: Run** `pnpm --dir apps/control test:stream-session-authority`; expected PASS.
- [ ] **Step 6: Commit** `fix(streaming): reconcile terminal stream states`.

### Task 2: Couple service ending to safe broadcast shutdown

**Files:**
- Create: `apps/control/src/lib/service-stream-lifecycle.ts`
- Modify: `apps/control/src/app/api/v1/services/[id]/state/route.ts`
- Modify: `apps/control/src/lib/stream-session-authority.ts`
- Test: `apps/control/scripts/service-stream-lifecycle-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Produce in `service-stream-lifecycle.ts`: `finalizeStreamsForEndedService(client, { serviceId, organizationId, actorId }) -> { endedSessionIds: string[], stopRequestedForDeviceId: string | null }`.
- The helper coordinates existing `enqueueServiceEdgeCommand` with stream-session terminalization: it attempts one best-effort `stream.stop` command while the publisher is still assigned, then marks DB stream/destination/grant state terminal even if the publisher is unavailable.

- [ ] **Step 1: Write failing tests** for live service + live stream, live service + stopping stream, offline/missing publisher, no active stream, and repeated `ended` requests.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:service-stream-lifecycle`; expected FAIL before integration exists.
- [ ] **Step 3: Implement `finalizeStreamsForEndedService`** with row locks, best-effort stop request bookkeeping, terminal state updates, and audit evidence.
- [ ] **Step 4: Call the helper in the service `ended` transaction before clearing `edge_devices.active_service_id`**; service end must not fail solely because Edge cannot accept the stop request.
- [ ] **Step 5: Publish stream/session realtime change after commit** together with existing service state change.
- [ ] **Step 6: Run** lifecycle + stream authority tests; expected PASS.
- [ ] **Step 7: Commit** `fix(control): end active broadcast with service`.

### Task 3: Authenticated Audience Studio and canonical links

**Files:**
- Create: `apps/control/src/lib/audience-links.ts`
- Create: `apps/control/src/app/audience/page.tsx`
- Create: `apps/control/src/components/audience/AudienceStudio.tsx`
- Modify: `apps/control/package.json` (add `qrcode` and type package if required)
- Test: `apps/control/scripts/audience-studio-selftest.mjs`

**Interfaces:**
- Produce: `canonicalAudienceUrl(origin, serviceId) -> string` and `audienceQrSvg(url) -> Promise<string>`.
- `AudienceStudio` receives current service/status, canonical URL, QR SVG, language availability, current live Scripture/caption summary, and stream readiness.

- [ ] **Step 1: Write failing tests** for canonical URL encoding, QR payload equality, no-service empty state, ready/live/ended readiness labels, and copy/preview actions.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:audience-studio`; expected FAIL because files do not exist.
- [ ] **Step 3: Implement URL and QR helpers** fully locally; no external QR service.
- [ ] **Step 4: Implement authenticated `/audience` server page** using current-service semantics and organization membership/RBAC.
- [ ] **Step 5: Implement `AudienceStudio`** with QR, copy link, open/embedded preview, service status, language/scripture/caption summary, program transport readiness, and setup/start guidance.
- [ ] **Step 6: Run** audience self-test + lint; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add audience studio`.

### Task 4: Formal public `/live` state matrix and realtime transition

**Files:**
- Modify: `apps/control/src/app/live/page.tsx`
- Modify: `apps/control/src/app/api/v1/audience/service/[id]/route.ts`
- Modify: `apps/control/src/components/audience/AudienceRealtimeRefresh.tsx`
- Test: `apps/control/scripts/audience-live-selftest.mjs`

**Interfaces:**
- Public service lookup may return non-sensitive state for `ready`, `live`, or `ended`; it never returns organization-internal metadata.
- State matrix: invalid/missing link, waiting, live, ended, unavailable.

- [ ] **Step 1: Write failing tests** for all five public states, `Cache-Control: no-store`, tenant/service scoping, and waiting -> live refresh behavior.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:audience-live`; expected FAIL on waiting/ended semantics.
- [ ] **Step 3: Refactor `/live` service query** to distinguish valid non-live/ended services from missing service while keeping live content queries gated to `live`.
- [ ] **Step 4: Update audience service API** to always return only `{ id, title, status }` for a valid service and add Scripture/transcript/language/program payload fields only when `status === "live"`; return no organization/user/internal routing metadata.
- [ ] **Step 5: Ensure realtime component falls back to 5-second polling** when event stream is unavailable and stops live-only subscriptions after service end.
- [ ] **Step 6: Run** audience-live + lint/build; expected PASS.
- [ ] **Step 7: Commit** `fix(audience): make live links state aware`.

### Task 5: Streaming Studio recovery and true program preview

**Files:**
- Modify: `apps/control/src/app/streaming/page.tsx`
- Modify: `apps/control/src/components/StreamingBroadcastControl.tsx`
- Reuse/Modify: `apps/control/src/components/audience/LiveProgramVideo.tsx`
- Modify: `apps/control/src/app/api/v1/edge/heartbeat/route.ts`
- Test: `apps/control/scripts/streaming-studio-ui-selftest.mjs`

**Interfaces:**
- Before presenting stream controls, active service reconciliation runs idempotently; Edge heartbeat also triggers reconciliation for its assigned service.
- `LiveProgramVideo` accepts an operator mode that shows direct WebRTC/HLS readiness/error labels without exposing public audience chrome.

- [ ] **Step 1: Write failing tests** for recovered stale state, program preview visibility, master/destination/provider label separation, and control re-enablement after stop finalization.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:streaming-studio-ui`; expected FAIL.
- [ ] **Step 3: Invoke stale reconciliation from periodic Edge heartbeat and the authenticated Streaming data load as a safe fallback**.
- [ ] **Step 4: Add program preview/readiness to Streaming Studio** using the existing service MediaMTX WebRTC path and HLS fallback.
- [ ] **Step 5: Update broadcast control messaging** so `starting/stopping` show bounded recovery state rather than an indefinite lock.
- [ ] **Step 6: Run** stream authority/fanout/provider-health/UI tests plus lint/build; expected PASS.
- [ ] **Step 7: Commit** `feat(streaming): add preview and lifecycle recovery`.

### Task 6: CI and production-state regression gate

**Files:**
- Modify: `.github/workflows/control-ci.yml`
- Verify: all new audience/stream tests plus existing `test:stream-fanout` and `test:stream-provider-health` under protected test DB only.

- [ ] **Step 1: Add new non-production-safe self-tests to CI in dependency order**; preserve the production DB guard for writable stream tests.
- [ ] **Step 2: Run all read-only/local tests plus `pnpm --dir apps/control lint && pnpm --dir apps/control build`**; expected PASS.
- [ ] **Step 3: Run writable DB stream tests only against the designated test database**; expected PASS and no production writes.
- [ ] **Step 4: Commit** `ci(control): gate audience and stream reliability`.
