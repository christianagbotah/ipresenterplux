# Competitive UX Phase 1 — Visual Sources Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the already-started Visual Sources Control Plane work so operators can safely discover and Preview Cameras, Screens, and Windows from one simple workspace while preserving Edge truth and the existing TAKE boundary.

**Architecture:** Continue PR #86 from head `e5f736844c0985a76948b76d4f3a0f62f287569c`; Tasks 1–3 of the native visual-capture Control Plane plan are already implemented there. Build the remaining UI on `listVisualSources(...)` and the durable `visual.rescan`, `visual.preview.select`, and `visual.preview.clear` commands, then project Edge-confirmed Program-source loss into Cockpit attention without inferring live state from command requests.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript, PostgreSQL, Zod, existing Edge command/audit/realtime pipeline.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md`

## Global Constraints

- Continue PR #86; do not reimplement its stable identity, telemetry sanitizer, or command authorization work.
- Preserve route `/cameras` and capability `canCameras`; visible product label becomes **Visual Sources**.
- Browser never captures physical sanctuary sources directly.
- Requested Preview state and Edge-confirmed Preview/Program state are different concepts in the UI.
- Source cards may Preview, rescan, or clear Preview; they never expose Go Live/TAKE/Program mutation.
- Keep operational text at least 12px and important touch targets at least 44px.
- Preserve camera label/preference behavior only for camera rows.

## Review Focus

- Two sources with the same friendly name on different Edge devices remain visually distinguishable.
- A successful command request must not create a confirmed Preview/Program badge before Edge telemetry confirms it.
- Stale telemetry must remove confirmed route claims and show a disconnected/stale state.
- Long window/process names must not overflow cards or disclose raw window titles/native keys.
- Read-only users may inspect source state but cannot issue visual commands.

---

### Task 1: Replace camera-only workspace with Visual Sources

**Files:**
- Modify: `apps/control/src/app/cameras/page.tsx`
- Create: `apps/control/src/components/cameras/VisualSourcesWorkspace.tsx`
- Delete after import migration: `apps/control/src/components/cameras/CameraWorkspace.tsx`
- Modify: `apps/control/scripts/camera-workspace-selftest.mjs`
- Create: `apps/control/scripts/visual-source-workspace-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Consumes: `listVisualSources(client, userId, organizationId)` from `apps/control/src/lib/camera-sources.ts`.
- Produces: `VisualSourcesWorkspace({ organizationId, sources, edgeDevices, canManage, canLiveControl })`.
- Visible categories: `camera -> Cameras`, `display -> Screens`, `window -> Windows`.

- [ ] **Step 1: Write failing structural test** asserting the three categories, `Visual Sources` title, Edge device label, capture status text, confirmed Preview/Program badges, 12px typography floor, and absence of any Go Live/TAKE source-card action.
- [ ] **Step 2: Run `pnpm --dir apps/control test:visual-source-workspace`; expect FAIL because the component/script is not implemented.**
- [ ] **Step 3: Implement `VisualSourcesWorkspace` and switch `/cameras` to `listVisualSources(...)` without changing route/capability names.**
- [ ] **Step 4: Preserve camera preference editing for `kind === "camera"`; omit it for screens/windows.**
- [ ] **Step 5: Run visual-source and camera compatibility tests; expect PASS.**
- [ ] **Step 6: Commit:** `git commit -m "feat(control): operate Edge visual sources"`.

---

### Task 2: Wire safe requested Preview controls

**Files:**
- Modify: `apps/control/src/components/cameras/VisualSourcesWorkspace.tsx`
- Create: `apps/control/src/lib/visual-source-actions.ts`
- Modify: `apps/control/scripts/visual-source-workspace-selftest.mjs`

**Interfaces:**
- `requestVisualAction(input: { edgeDeviceId: string; serviceId: string | null; action: "rescan" | "preview" | "clear_preview"; sourceId?: string }): Promise<{ commandId?: string; message: string }>`.
- Maps actions exactly to existing command types `visual.rescan`, `visual.preview.select`, `visual.preview.clear`.
- Pending action state is local/requested only; confirmed badges still come exclusively from sanitized Edge telemetry.

- [ ] **Step 1: Add failing tests for live-control gating, exact durable command names, pending-vs-confirmed copy, and no `program.take`/`program.show` call path.**
- [ ] **Step 2: Run workspace test; expect FAIL on missing action client.**
- [ ] **Step 3: Implement action client and `Preview`, `Rescan sources`, `Clear Preview` controls with one in-flight action per Edge device.**
- [ ] **Step 4: Run `test:visual-edge-command`, `test:visual-source-workspace`, and `test:rbac-ui`; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(control): add safe visual Preview controls"`.

---

### Task 3: Project confirmed Program-source loss into Cockpit attention

**Files:**
- Modify: `apps/control/src/lib/cockpit/view-model.ts`
- Modify: `apps/control/src/lib/cockpit/attention.ts`
- Modify: `apps/control/src/components/cockpit/NowRail.tsx`
- Modify: `apps/control/scripts/cockpit-view-model-selftest.mjs`
- Modify: `apps/control/scripts/cockpit-attention-selftest.mjs`

**Interfaces:**
- Program visual source is considered confirmed only when fresh telemetry reports `programActive=true`.
- `captureStatus in {disconnected,error}` on that confirmed Program source yields actionable attention linking to `/cameras`.
- No automatic source switching is claimed or triggered.

- [ ] **Step 1: Add failing tests for confirmed source loss, stale-telemetry suppression, and requested-command false-positive prevention.**
- [ ] **Step 2: Run cockpit view-model/attention tests; expect FAIL.**
- [ ] **Step 3: Implement the view-model projection and user-impact-first attention copy.**
- [ ] **Step 4: Run `test:cockpit-view-model`, `test:cockpit-attention`, and `test:cockpit-acceptance`; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(control): surface visual source loss in Cockpit"`.

---

### Task 4: Phase verification and merge gate

**Files:**
- Modify only if required by failures: `.github/workflows/control-ci.yml`

**Interfaces:**
- PR #86 remains the delivery branch for this phase.

- [ ] **Step 1: Run all PR #86 visual identity, telemetry, command, workspace, RBAC and Cockpit self-tests.**
- [ ] **Step 2: Run `pnpm --dir apps/control lint` and `pnpm --dir apps/control build`; expect zero errors.**
- [ ] **Step 3: Run full Control Portal CI on the exact PR head and require green before merge.**
- [ ] **Step 4: Field-UAT on Windows hardware: camera, display, and window discovery; Preview selection; source loss; reconnect; long names; no live mutation from source cards.**
- [ ] **Step 5: Merge only after CI + physical UAT evidence is recorded.**
