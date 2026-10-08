# Studio Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining dead studio modules with truthful, useful Songs & Media, Cameras, AI Director, and Archive workspaces built on existing service, Edge, presentation, worker-health, and recording foundations.

**Architecture:** Reuse Planner presentation items for media/song cues, Edge `media_sources` telemetry for camera truth, current ASR/Scripture/translation/TTS state for AI Director, and ended-service histories for Archive. Add only the minimum storage needed for reusable media metadata/artifact records; do not pretend browser/VPS code owns church cameras or local recordings that actually belong to Edge.

**Tech Stack:** Next.js App Router, React 19, TypeScript, PostgreSQL/pg, existing Planner/Edge APIs, existing role-capability + entitlement services.

**Spec:** `docs/superpowers/specs/2026-10-07-missing-studio-workspaces-design.md`

## Global Constraints

- A visible module must be a usable workflow or truthful readiness/status screen with a concrete setup action; never a decorative placeholder.
- Cross-workspace current-service semantics match Control Room/Planner/Operator.
- Edge-owned capture is reported as Edge-owned; the VPS browser must never claim direct camera access it does not have.
- AI Director remains advisory/auto-preview only; no unreviewed direct Program authority in Phase 1.
- Archive access is organization scoped; subscription expiry does not delete local church metadata.
- RBAC controls who may act; entitlement controls licensed availability; neither replaces tenant isolation.

## Review Focus

- No paired Edge/device must produce a setup CTA rather than empty camera/media panels; covered in Task 2 tests.
- Unsupported/native-only media types must render a clear status and never silently fail Preview; covered in Task 1 tests.
- AI worker outage must degrade health/status without exposing a direct Program mutation path; covered in Task 3 tests.
- Archive detail URLs for another organization must return 404/403 without leaking service titles or artifact metadata; covered in Task 4 tests.
- Missing/expired recording files must keep the service archive page usable and label the artifact unavailable; covered in Task 4 tests.

---

### Task 1: Songs & Media workspace

**Files:**
- Create: `apps/control/db/038_media_archive_foundation.sql`
- Create: `apps/control/src/lib/media-library.ts`
- Create: `apps/control/src/app/media/page.tsx`
- Create: `apps/control/src/components/media/MediaWorkspace.tsx`
- Create: `apps/control/src/app/api/v1/media/items/route.ts`
- Create: `apps/control/src/app/api/v1/media/items/[id]/route.ts`
- Test: `apps/control/scripts/media-workspace-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Migration adds reusable `media_library_items`, `service_artifacts`, and `camera_source_preferences(organization_id, media_source_id, operator_label, preferred, updated_by, updated_at)` metadata only; binary/local Edge media remains outside PostgreSQL.
- `media-library.ts` exposes `listMediaLibrary`, `createMediaLibraryItem`, and `addMediaItemToServiceRundown` mapping supported items into existing `presentation_items`.
- Supported Phase 1 Planner mappings are exactly `song`, `slide`, and `media` with `mediaKind` of `image`, `video`, or `audio`; any source that cannot satisfy those existing schemas is shown as native-only/unsupported and is not sent to Preview.

- [ ] **Step 1: Write failing tests** for list/search, structured song create, add-to-rundown, tenant isolation, unsupported media marking, no-service reusable-library state, and Preview eligibility.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:media-workspace`; expected FAIL.
- [ ] **Step 3: Add migration 038** for reusable media/artifact metadata with organization/service foreign keys and no binary blobs.
- [ ] **Step 4: Implement media-library service and APIs** using existing planner mutation rules for service rundown insertion.
- [ ] **Step 5: Implement `/media`** with search, create structured song/text cue, reusable assets, current-service rundown insertion, Edge/local availability status, and explicit Preview eligibility.
- [ ] **Step 6: Run** media + Planner regression tests + lint/build; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add songs and media workspace`.

### Task 2: Cameras readiness and routing workspace

**Files:**
- Create: `apps/control/src/lib/camera-sources.ts`
- Create: `apps/control/src/app/cameras/page.tsx`
- Create: `apps/control/src/components/cameras/CameraWorkspace.tsx`
- Create: `apps/control/src/app/api/v1/cameras/preferences/route.ts`
- Test: `apps/control/scripts/camera-workspace-selftest.mjs`

**Interfaces:**
- `listCameraSources(organizationId)` reads `media_sources` where source type represents video/camera and joins reporting `edge_devices`.
- Status is one of `available`, `disconnected`, `permission_required`, `unsupported`; browser-local capture is never inferred.
- Camera preference API reads/writes `camera_source_preferences` from migration 038 for operator labels and preferred source state; device/admin role required for mutation.

- [ ] **Step 1: Write failing tests** for source/device join, stale telemetry -> disconnected, no paired Edge CTA, cross-org denial, view-only status, mutation RBAC, and no browser `getUserMedia` claim.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:camera-workspace`; expected FAIL.
- [ ] **Step 3: Implement camera source query/status mapping** from Edge telemetry and source metadata.
- [ ] **Step 4: Implement preference API** to upsert/delete `camera_source_preferences` rows scoped by organization + `media_source_id`, with device/admin RBAC and audit events.
- [ ] **Step 5: Implement `/cameras`** with readiness cards, reporting Edge device, last-seen status, supported preview link only when runtime advertises it, and direct link to `/settings/devices` when setup is missing.
- [ ] **Step 6: Run** camera test + lint/build; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add camera readiness workspace`.

### Task 3: AI Director advisory control center

**Files:**
- Create: `apps/control/src/lib/ai-director.ts`
- Create: `apps/control/src/app/ai-director/page.tsx`
- Create: `apps/control/src/components/ai-director/AIDirectorWorkspace.tsx`
- Create: `apps/control/src/app/api/v1/ai/director/settings/route.ts`
- Test: `apps/control/scripts/ai-director-selftest.mjs`

**Interfaces:**
- `getAIDirectorState` returns ASR/media-source health, recent Scripture detections/recommendations, translation/TTS worker health, auto-preview threshold, and service AI enablement.
- Settings mutations are limited to approved service-level enablement/auto-preview threshold and require both authorized role and the `ai.director` entitlement introduced by the subscription plan.
- No API or UI action from this workspace calls Program/Take directly.

- [ ] **Step 1: Write failing tests** for worker healthy/degraded/offline mapping, recent recommendation evidence/confidence, threshold validation, entitlement/RBAC, and explicit absence of direct Program authority.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:ai-director`; expected FAIL.
- [ ] **Step 3: Implement AI state aggregation** from existing media source, transcript/detection, translation and TTS tables.
- [ ] **Step 4: Implement settings API** for enablement + threshold only; audit each change.
- [ ] **Step 5: Implement `/ai-director`** with health, recommendations, source evidence, advisory/auto-preview labels, and links to Scripture/Translations/Operator.
- [ ] **Step 6: Run** AI Director + existing scripture/translation regression tests + lint/build; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add ai director workspace`.

### Task 4: Archive list and service detail

**Files:**
- Create: `apps/control/src/lib/archive.ts`
- Create: `apps/control/src/app/archive/page.tsx`
- Create: `apps/control/src/app/archive/[id]/page.tsx`
- Create: `apps/control/src/components/archive/ArchiveList.tsx`
- Create: `apps/control/src/components/archive/ArchiveServiceDetail.tsx`
- Create: `apps/control/src/app/api/v1/archive/[id]/artifacts/[artifactId]/route.ts`
- Test: `apps/control/scripts/archive-selftest.mjs`

**Interfaces:**
- `listArchivedServices(userId, filters)` returns only ended services in organizations the user belongs to.
- `getArchivedService(userId, serviceId)` returns service metadata, final rundown, Scripture history, retained transcript/caption summary, and authorized `service_artifacts` metadata.
- Artifact route either redirects/streams an authorized available artifact or returns explicit unavailable/expired state; it never guesses missing local paths.

- [ ] **Step 1: Write failing tests** for ended-service list/filter, tenant isolation, detail history, missing recording resilience, artifact authorization, and nested route active-nav matching.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:archive`; expected FAIL.
- [ ] **Step 3: Implement archive query service** using existing `services`, `presentation_items`, `scripture_detections`, transcript/translation history and new artifact metadata.
- [ ] **Step 4: Implement list/detail pages** with clear retained/missing/expired artifact states.
- [ ] **Step 5: Implement artifact access route** with organization/RBAC/entitlement checks and no raw unauthorized storage paths in responses.
- [ ] **Step 6: Run** archive test + lint/build; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add service archive workspace`.

### Task 5: Shared service context, sidebar integration and gating

**Files:**
- Create: `apps/control/src/lib/current-service.ts`
- Modify: `apps/control/src/app/DashboardPage.tsx`
- Modify: `apps/control/src/app/operator/page.tsx`
- Modify: `/media`, `/cameras`, `/ai-director`, `/archive` pages from Tasks 1-4
- Modify shared navigation capability/entitlement mapping
- Test: `apps/control/scripts/studio-route-gating-selftest.mjs`

**Interfaces:**
- Produce: `getCurrentServiceForUser(userId) -> { service, organizationId, roles, capabilities } | null` using the existing live -> ready -> newest ordering.
- Visible route gating combines role capability + entitlement visibility but server APIs independently enforce both again.

- [ ] **Step 1: Write failing tests** for consistent service selection, route visibility/actionability, nested archive active state, and entitled-but-unauthorized / authorized-but-unentitled behavior.
- [ ] **Step 2: Run** route-gating self-test; expected FAIL.
- [ ] **Step 3: Extract shared current-service query** and replace duplicated semantics where touched by this program.
- [ ] **Step 4: Wire workspace visibility/actionability** through the shared studio navigation source without creating dead buttons.
- [ ] **Step 5: Run** navigation + workspace + lint/build tests; expected PASS.
- [ ] **Step 6: Commit** `refactor(control): share studio service context`.

### Task 6: CI and end-to-end sidebar acceptance gate

**Files:**
- Modify: `.github/workflows/control-ci.yml`
- Verify all four workspace self-tests + navigation/gating tests.

- [ ] **Step 1: Add media/camera/AI/archive tests to Control Portal CI** after schema/setup and before build.
- [ ] **Step 2: Run** all four workspace tests, studio navigation/gating tests, Planner/Scripture regressions, lint and build; expected PASS.
- [ ] **Step 3: Verify route manifest** contains `/media`, `/cameras`, `/ai-director`, `/archive`, `/archive/[id]` and that every visible sidebar route responds through its authorized UI path.
- [ ] **Step 4: Commit** `ci(control): gate all studio workspaces`.
