# Navigation and Scripture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every visible studio navigation item actionable and deliver a complete local-Bible Scripture workspace that feeds the existing Preview -> Program pipeline.

**Architecture:** Extract the studio route map/sidebar into reusable navigation components, add a Bible-library service over the existing PostgreSQL tables, and create manual Scripture detections that reuse the existing state-transition and Edge-command pipeline. Keep `/operator` as the fast live console and `/scripture` as the full browse/search workspace.

**Tech Stack:** Next.js App Router, React 19, TypeScript, PostgreSQL/pg, Zod, existing realtime/event infrastructure, existing Edge control commands.

**Spec:** `docs/superpowers/specs/2026-10-07-navigation-scripture-usability-design.md`

## Global Constraints

- Every visible sidebar item must resolve to a real route; active state is pathname-driven.
- Bible search/browse uses only local `bible_versions`, `bible_books`, and `bible_verses` during live service operation.
- Selecting a passage never changes Preview or Program by itself.
- Preview is explicit; new surfaces only permit Take Live for the item currently in Preview.
- Existing API callers remain backward-compatible.
- Live mutations require existing live-operator RBAC; Bible viewing requires authenticated organization membership.
- Core local Scripture remains available through entitlement offline grace.

## Review Focus

- Malformed/oversized references such as `John 3:0`, reversed ranges, and >80-verse passages must fail without creating a detection; covered in Task 2 tests.
- A user without live-control RBAC may browse but cannot create/stage a manual service detection; covered in Task 3 tests.
- Ended/no-service states must keep Bible browsing usable while disabling live controls with explicit copy; covered in Task 4 tests.
- Collapsed/mobile navigation must contain the same actionable route set as desktop; covered in Task 1 tests.
- A detection arriving through realtime refresh must not steal the operator's selected item; preserved by Task 5 regression tests.

---

### Task 1: Shared route-driven studio navigation

**Files:**
- Create: `apps/control/src/components/navigation/studio-routes.ts`
- Create: `apps/control/src/components/navigation/StudioSidebar.tsx`
- Create: `apps/control/src/components/navigation/StudioMobileNav.tsx`
- Modify: `apps/control/src/app/DashboardPage.tsx`
- Test: `apps/control/scripts/studio-navigation-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Produces: `StudioRoute` and `studioRoutes`, plus `StudioSidebar({ capabilities })` and `StudioMobileNav({ capabilities })`.
- Route mapping is exactly `/`, `/scripture`, `/media`, `/cameras`, `/ai-director`, `/translations`, `/streaming`, `/audience`, `/archive`, `/settings`.

- [ ] **Step 1: Write the failing navigation self-test** asserting every visible label maps to the required non-null route, parent active matching works for nested paths, and mobile/desktop consume the same route source.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:studio-navigation`; expected FAIL because the shared navigation source does not exist.
- [ ] **Step 3: Implement the shared route source and responsive navigation components** using `usePathname()` only for active-state presentation; keep capability filtering data-driven.
- [ ] **Step 4: Replace the hard-coded dashboard `nav` array/buttons** with `StudioSidebar` and add the mobile navigation surface without duplicating route definitions.
- [ ] **Step 5: Run** `pnpm --dir apps/control test:studio-navigation && pnpm --dir apps/control lint`; expected PASS.
- [ ] **Step 6: Commit** `feat(control): make studio navigation route driven`.

### Task 2: Local Bible library service

**Files:**
- Create: `apps/control/src/lib/bible-library.ts`
- Modify: `apps/control/src/lib/planner-scripture.ts`
- Test: `apps/control/scripts/bible-library-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Produces: `listLocalBibleVersions(client)`, `listBibleBooks(client, versionId)`, `listBibleChapter(client, versionId, bookCode, chapter)`, and `resolveLocalScripture(client, { reference, version }) -> ResolvedLocalScripture`.
- `ResolvedLocalScripture` exposes canonical reference, version ID/abbreviation, canonical book/book code, chapter, optional verse range, and joined passage text.
- `planner-scripture.ts` delegates to this service so Planner and Scripture share one resolver.

- [ ] **Step 1: Write failing tests** for `John 3:16`, `John 3:16-18`, `Psalm 23`, bad verse zero, reversed range, unavailable version/book, and the existing 80-verse safety ceiling.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:bible-library`; expected FAIL because `bible-library.ts` is absent.
- [ ] **Step 3: Implement the four library functions** using database-derived book/chapter/verse truth and the existing operator reference parser; no external HTTP calls.
- [ ] **Step 4: Refactor `resolvePlannerScripture`** to map the shared result into its existing public type without changing Planner callers.
- [ ] **Step 5: Run** `pnpm --dir apps/control test:bible-library && pnpm --dir apps/control test:service-planner-item`; expected PASS.
- [ ] **Step 6: Commit** `refactor(control): centralize local Bible resolution`.

### Task 3: Manual Scripture selection into the existing service pipeline

**Files:**
- Create: `apps/control/db/036_manual_scripture_workspace.sql`
- Create: `apps/control/src/lib/manual-scripture.ts`
- Create: `apps/control/src/app/api/v1/scriptures/manual/route.ts`
- Test: `apps/control/scripts/manual-scripture-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Migration adds `manual` to the existing `scripture_detections.detection_method` check; no other detection semantics change.
- Produces: `createManualScriptureDetection(client, { serviceId, reference, version, actorId }) -> { id, reference, state: "detected", passageText }`.
- Browser API accepts `{ serviceId, reference, version }`; it verifies organization scope + `LIVE_OPERATOR_ROLES`, resolves locally, inserts/reuses an equivalent non-dismissed manual detection, audits, and publishes `scripture.detected`.

- [ ] **Step 1: Write failing tests** for authorized creation, same-service idempotent reuse, cross-organization denial, ended-service rejection, malformed reference rejection, and `manual` provenance.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:manual-scripture`; expected FAIL before migration/service/API exist.
- [ ] **Step 3: Add migration 036** expanding the provenance constraint to include `manual` while preserving existing values.
- [ ] **Step 4: Implement `createManualScriptureDetection`** with service row locking, local resolver use, duplicate reuse, audit event, and no Preview/Program mutation.
- [ ] **Step 5: Implement POST `/api/v1/scriptures/manual`** with auth, force-password-change, UUID/Zod validation, organization/RBAC enforcement, transaction, and realtime publish after commit.
- [ ] **Step 6: Run** `pnpm --dir apps/control test:manual-scripture && pnpm --dir apps/control test:db-selftest-safety`; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add manual scripture service selections`.

### Task 4: Full `/scripture` workspace

**Files:**
- Create: `apps/control/src/app/scripture/page.tsx`
- Create: `apps/control/src/components/scripture/ScriptureWorkspace.tsx`
- Create: `apps/control/src/app/api/v1/scriptures/library/route.ts`
- Test: `apps/control/scripts/scripture-workspace-ui-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- `GET /api/v1/scriptures/library?version=<id>&book=<code>&chapter=<n>` returns authenticated local versions/books/chapter verses only.
- `ScriptureWorkspace` consumes current service, capabilities, versions/books, recent detections, current Preview/Program IDs, and calls manual selection plus existing `/api/v1/scriptures/[id]/state` for Preview/Program/Clear behavior.

- [ ] **Step 1: Write failing UI/contract tests** for search/browse, recent AI detections, explicit Select -> Preview -> Take Live, disabled live controls for ended/no service, and clear library-missing messaging.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:scripture-workspace-ui`; expected FAIL because route/component/API are absent.
- [ ] **Step 3: Implement authenticated server page data loading** using current-service semantics shared with Operator/Control Room.
- [ ] **Step 4: Implement the read-only library endpoint** with local DB truth and no-store response semantics.
- [ ] **Step 5: Implement `ScriptureWorkspace`** with direct-reference search, version/book/chapter/range browsing, manual selection creation, recent detections, Preview/Program status, and explicit action feedback.
- [ ] **Step 6: Run** `pnpm --dir apps/control test:scripture-workspace-ui && pnpm --dir apps/control lint && pnpm --dir apps/control build`; expected PASS.
- [ ] **Step 7: Commit** `feat(control): add complete scripture workspace`.

### Task 5: Operator/navigation regression gate and CI

**Files:**
- Modify: `.github/workflows/control-ci.yml`
- Verify: `apps/control/scripts/operator-workspace-selftest.mjs`
- Verify: new navigation/Bible/manual/Scripture self-tests

**Interfaces:**
- Produces one CI gate proving route parity + local Bible + manual pipeline + existing Option A keyboard/selection safety together.

- [ ] **Step 1: Add the four new self-tests to Control Portal CI** before build.
- [ ] **Step 2: Run locally** `pnpm --dir apps/control test:studio-navigation && pnpm --dir apps/control test:bible-library && pnpm --dir apps/control test:manual-scripture && pnpm --dir apps/control test:scripture-workspace-ui && pnpm --dir apps/control test:operator-workspace`.
- [ ] **Step 3: Run** `pnpm --dir apps/control lint && pnpm --dir apps/control build`; expected PASS.
- [ ] **Step 4: Commit** `ci(control): gate navigation and scripture workflows`.
