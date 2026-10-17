# Native Edge Visual Capture v1 — Control Plane & Operator UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows Edge visual-source truth durable and operable from the existing Cameras workspace without introducing any shortcut around Preview → TAKE → Program.

**Architecture:** Keep the existing `/api/v1/edge/media-source` event envelope and broad status vocabulary for compatibility, but make source uniqueness Edge-device/source-key based and carry detailed capture state in allowlisted metadata. Extend the existing durable Edge command API with `visual.rescan`, `visual.preview.select`, and `visual.preview.clear`; evolve `/cameras` into the source workspace for Cameras, Screens, and Windows, showing desired vs Edge-confirmed Preview/Program state separately.

**Tech Stack:** Next.js 16.3.8, TypeScript, PostgreSQL, Zod, React, existing RBAC/audit/event command pipeline.

**Spec:** `docs/superpowers/specs/2026-10-10-native-edge-visual-capture-design.md`

## Global Constraints

- Browser never captures sanctuary camera/display/window content directly.
- Only authenticated enrolled Edge devices report source telemetry.
- Only existing authorized live-operator roles may issue visual Preview/rescan commands.
- Source-card actions never issue `program.take` or `program.show`.
- UI must distinguish requested state from Edge-confirmed state.
- Window metadata never exposes arbitrary full titles or filesystem paths.
- Additive migrations only; preserve existing camera preferences and imported media rows.

## Review Focus

- Two Edge devices may report identical friendly source names without overwriting each other.
- An old telemetry event must never roll back a newer capture/route state.
- A command acknowledged as succeeded is not enough to label a source Preview/Program until Edge telemetry confirms it.
- Stale source/device telemetry must remove confirmed Preview/Program badges and show disconnected guidance.
- Users without live-control permission may inspect source truth but cannot rescan/select Preview.

---

### Task 1: Move media-source uniqueness to Edge device + source key

**Files:**
- Create: `apps/control/db/042_visual_source_identity.sql`
- Modify: `apps/control/src/app/api/v1/edge/media-source/route.ts`
- Modify: `apps/control/scripts/camera-workspace-selftest.mjs`
- Create: `apps/control/scripts/visual-source-identity-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- New partial unique index: `(organization_id, edge_device_id, source_key)` where `edge_device_id IS NOT NULL AND source_key IS NOT NULL`.
- Preserve the foundation `UNIQUE (organization_id, name)` constraint to keep the migration additive and compatible with imported/manual sources; it is no longer treated as source identity.
- Edge telemetry update path first resolves the stable tuple. Existing tuple -> update that row by id. New tuple -> allocate a collision-safe storage `name` (friendly name when free, otherwise friendly name plus a bounded Edge/source suffix) while preserving the original reported friendly name in sanitized metadata for display.

- [ ] **Step 1: Write RED DB self-test**
  - same friendly name from Edge A and Edge B creates two rows with distinct storage names but the same operator-visible reported name;
  - same Edge/sourceKey with renamed friendly name updates one row;
  - stale observedAt cannot overwrite newer friendly name/status/metadata;
  - legacy rows with null Edge/source key remain valid and keep their existing name uniqueness.

- [ ] **Step 2: Add migration with duplicate-safe preflight**
  - Detect duplicate non-null `(organization_id,edge_device_id,source_key)` and fail with an explicit migration error rather than deleting data silently.
  - Add the partial unique index without dropping existing constraints or deleting/rewriting legacy rows.

- [ ] **Step 3: Change media-source persistence to resolve/update by stable tuple and retain event dedupe semantics**

- [ ] **Step 4: Run migration + identity self-test; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "fix(control): key Edge media sources by stable source identity"`

---

### Task 2: Accept and sanitize visual-source metadata

**Files:**
- Modify: `apps/control/src/app/api/v1/edge/media-source/route.ts`
- Modify: `apps/control/src/lib/camera-sources.ts`
- Create: `apps/control/src/lib/visual-source-metadata.ts`
- Create: `apps/control/scripts/visual-source-telemetry-selftest.mjs`

**Interfaces:**
- Preserve broad wire `status`: `offline | ready | live | warning | error`.
- Recognized `sourceType`: existing camera aliases plus `camera | display | window`.
- Allowlisted metadata keys: `captureStatus`, `width`, `height`, `fps`, `previewActive`, `programActive`, `framesCaptured`, `droppedFrames`, `errorCode`, `processName`, `displayPrimary`.
- `captureStatus`: `available | busy | permission_required | disconnected | unsupported | error`.
- Parse booleans/numbers defensively from string metadata; reject/ignore unknown sensitive keys from UI exposure.

- [ ] **Step 1: Write RED telemetry sanitizer tests**
  - arbitrary `windowTitle`, `path`, `token`, `nativeKey` are not exposed by list helpers;
  - malformed dimensions/counters do not crash rendering;
  - detailed capture status maps to operator copy.

- [ ] **Step 2: Implement sanitizer and extend listing model from camera-only to visual-source aware while keeping camera preference joins**

- [ ] **Step 3: Run telemetry + camera workspace tests; expect PASS**

- [ ] **Step 4: Commit**

`git commit -m "feat(control): normalize visual source telemetry"`

---

### Task 3: Extend durable Edge command allowlist and RBAC

**Files:**
- Modify: `apps/control/src/lib/edge-commands.ts`
- Modify: `apps/control/src/app/api/v1/edge/devices/[id]/commands/route.ts`
- Create: `apps/control/scripts/visual-edge-command-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Add command types exactly:
  - `visual.rescan`
  - `visual.preview.select`
  - `visual.preview.clear`
- All use `LIVE_OPERATOR_ROLES`.
- `visual.preview.select` requires `arguments.sourceId`; source must belong to the requested Edge device + organization before command insertion.
- `visual.rescan` / `visual.preview.clear` reject irrelevant sourceId arguments but remain idempotent at Edge execution.

- [ ] **Step 1: Write RED API tests for RBAC, tenant/device ownership, inactive Edge, service scope, and source ownership**

- [ ] **Step 2: Extend command validation without adding any visual live command**

- [ ] **Step 3: Assert audit detail records command type/device/service but never sensitive source native metadata**

- [ ] **Step 4: Run command self-test + RBAC UI test; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "feat(control): authorize durable visual preview commands"`

---

### Task 4: Evolve Cameras into a Visual Sources workspace

**Files:**
- Modify: `apps/control/src/app/cameras/page.tsx`
- Modify: `apps/control/src/components/cameras/CameraWorkspace.tsx`
- Rename or create: `apps/control/src/components/cameras/VisualSourcesWorkspace.tsx`
- Modify: `apps/control/src/lib/camera-sources.ts`
- Modify: `apps/control/scripts/camera-workspace-selftest.mjs`
- Create: `apps/control/scripts/visual-source-workspace-selftest.mjs`

**Interfaces:**
- Preserve route `/cameras` and navigation capability `canCameras`; visible page title may become **Visual Sources** with tabs/categories **Cameras / Screens / Windows**.
- Source card shows: operator label/friendly name, kind, Edge device, capture status, last report, `Preview` badge, `Program` badge, preferred camera state where applicable.
- Actions for authorized users:
  - `Preview` -> durable `visual.preview.select` command only;
  - `Rescan sources` -> `visual.rescan` command;
  - `Clear Preview` -> `visual.preview.clear` command;
  - Label/preference remains camera-only where existing preference semantics apply.
- There is no `Go Live`, `Take`, or `Program` mutation button in this workspace.

- [ ] **Step 1: Write RED structural/UI tests**
  - three categories present;
  - Preview action exists only with live-control capability;
  - source cards never contain a live-promotion endpoint/command;
  - status uses text/icon, not color alone;
  - laptop width and long names wrap/truncate safely;
  - 12px operational text floor remains satisfied.

- [ ] **Step 2: Implement source grouping and richer cards using Edge-confirmed telemetry only**

- [ ] **Step 3: Implement rescan/preview/clear command creation with pending/requested feedback that is visually distinct from confirmed badges**

- [ ] **Step 4: Preserve preference editing for camera rows and hide it for display/window rows**

- [ ] **Step 5: Run workspace, RBAC, navigation, cockpit, and switching-moat tests**

- [ ] **Step 6: Commit**

`git commit -m "feat(control): operate Edge visual sources from Cameras workspace"`

---

### Task 5: Surface visual source attention without false live claims

**Files:**
- Modify: `apps/control/src/lib/cockpit/view-model.ts`
- Modify: `apps/control/src/lib/cockpit/attention.ts`
- Modify: `apps/control/src/components/cockpit/NowRail.tsx`
- Modify: `apps/control/scripts/cockpit-view-model-selftest.mjs`
- Modify: `apps/control/scripts/cockpit-attention-selftest.mjs`

**Interfaces:**
- Camera/visual system freshness follows Edge-confirmed telemetry timestamps.
- High-priority attention is emitted when `programActive=true` and `captureStatus` becomes `disconnected`/`error` after freshness validation.
- Never infer Program from command state alone.
- Operator guidance points to `/cameras`; automatic switching is never suggested as already performed.

- [ ] **Step 1: Write RED tests for live-source loss attention, stale telemetry, and false-positive prevention**

- [ ] **Step 2: Implement visual Program attention mapping**

- [ ] **Step 3: Run cockpit acceptance + switching-moat + workspace tests**

- [ ] **Step 4: Commit**

`git commit -m "feat(control): surface Edge visual source attention"`

---

## Phase verification

- [ ] `pnpm --dir apps/control db:migrate` against isolated CI DB.
- [ ] `pnpm --dir apps/control test:camera-workspace`
- [ ] new visual identity/telemetry/command/workspace self-tests.
- [ ] `pnpm --dir apps/control test:rbac-ui`
- [ ] `pnpm --dir apps/control test:cockpit-acceptance`
- [ ] `pnpm --dir apps/control test:switching-moat-acceptance`
- [ ] `pnpm --dir apps/control test:studio-route-gating`
- [ ] `pnpm --dir apps/control lint`
- [ ] `pnpm --dir apps/control build`
- [ ] Full Control Portal CI green before merge.
