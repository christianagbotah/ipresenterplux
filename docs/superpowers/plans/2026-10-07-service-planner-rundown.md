# Service Planner & Rundown Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an organization-scoped Service Planner that authors typed, ordered, readiness-validated service rundowns in the Control Plane and turns the existing Windows/macOS desktop catalog into a real Order of Service without changing the Edge credential/security boundary.

**Architecture:** The Control Plane remains authoritative for `services` and `presentation_items`. Planner web APIs enforce Auth.js session, existing RBAC, service/organization scope, typed cue validation, transactionality, audit events, and an optimistic `If-Match` revision. Existing device-authenticated Edge catalog sync remains the only cloud-to-desktop transport; the desktop gains only presentation/selection semantics over its already-cached catalog and local IPC.

**Tech Stack:** Next.js 16 / React / TypeScript, Auth.js, PostgreSQL via existing `db`/`query` helpers, Zod, Node self-tests, .NET 10, Avalonia 12, xUnit, existing GitHub Actions Control/Edge CI.

**Spec:** `docs/superpowers/specs/2026-10-07-service-planner-rundown-design.md`

## Global Constraints

- Reuse the existing `services` and `presentation_items` tables; do not create a parallel planner store.
- Planner mutation roles are exactly `owner`, `admin`, `pastor`, `presenter_operator`, `media_operator`; existing backend RBAC remains authoritative.
- `translator`, `finance`, `welfare`, `group_leader`, and `viewer` are planner read-only.
- `draft` services never sync to Edge; the existing Edge catalog continues to expose only the device-assigned `ready`/`live` service.
- Planner structural mutations are allowed only for `draft`/`ready`; `live`, `ended`, and `archived` are structurally read-only in Phase 1.
- Any persisted planner metadata/item/reorder mutation against a `ready` service demotes it to `draft` and clears Edge devices assigned to that service in the same transaction; the user must explicitly pass readiness and mark it ready again.
- Maximum 200 rundown items per service; maximum 64 song sections; normalized presentation body <= 12,000 characters; footer/subtitle <= 500 characters.
- Scripture range safety remains the existing maximum of 80 verses.
- Planner Preview never writes Program state and never sends a remote Edge mutation command.
- Planner adds no manual device-assignment workflow; Settings -> Edge Devices remains the device administration surface and existing service lifecycle auto-assignment for eligible campus devices is preserved.
- The Avalonia shell never receives device bearer credentials, pairing codes, OAuth tokens, stream keys, or planner session cookies.
- Loopback Preview/Program HTTP remains read-only; all local presentation mutations continue over same-user IPC.
- Song fixtures/tests use public-domain text only; do not add copyrighted lyrics to repository fixtures.
- Media cues do not accept arbitrary local paths or free-form unsafe URLs; Phase 1 uses existing application-managed media metadata/approved HTTPS references only.
- Existing Windows/macOS Edge tests, native bridge checks, libsrt verification, MediaMTX SRT smoke, Control Portal lint/build/self-tests remain release gates.

## Review Focus

- **Concurrent planners:** stale `If-Match` revision must return `409 planner_revision_conflict` without overwriting newer work; pinned by Task 4 DB integration tests.
- **Cross-tenant/service IDs:** foreign service/item/campus/media IDs must behave as not-found/forbidden without existence leakage; pinned by Tasks 2-4 DB integration tests.
- **Ready bypass:** every path that can request `ready`, including the existing service-state endpoint, must run the same readiness validator; pinned by Task 5 tests.
- **Ready edit safety:** any persisted planner metadata/item/reorder mutation on a ready service must atomically demote it to `draft`, clear that service's Edge assignments, and change the catalog visibility/revision; pinned by Tasks 2, 4, 5, and 9 tests.
- **Ad-hoc Program content:** desktop current/next logic must not corrupt rundown position when Program/Preview item IDs are absent from the cached planner rundown; pinned by Task 10 xUnit tests.

---

### Task 1: Shared planner policy, contracts, normalization, and revision token

**Files:**
- Modify: `apps/control/src/lib/role-policy.js`
- Modify: `apps/control/src/lib/role-capabilities.ts`
- Create: `apps/control/src/lib/planner-contracts.ts`
- Create: `apps/control/src/lib/planner-revision.ts`
- Create: `apps/control/scripts/service-planner-contract-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: existing `LIVE_OPERATOR_ROLES`, `DEVICE_ADMIN_ROLES`, Edge normalization limits.
- Produces: `PLANNER_VIEW_ROLES`, `PLANNER_MUTATION_ROLES`, `canViewPlanner`, `canPlanServices`; `PlannerServiceStatus`, `PlannerItemType`, `PlannerRevisionSource`, `computePlannerRevision(source): string`, shared constants `PLANNER_MAX_ITEMS=200`, `PLANNER_MAX_SONG_SECTIONS=64`, `PLANNER_BODY_MAX=12000`, `PLANNER_FOOTER_MAX=500`.

- [ ] **Step 1: Write the failing contract self-test**

Add assertions that all ten demo roles are in `PLANNER_VIEW_ROLES`, mutation roles equal the five spec roles exactly, `canViewPlanner` is true for all ten known organization roles while `canPlanServices` is true only for the five mutation roles, limits equal the spec values, and `computePlannerRevision` is stable for identical ordered inputs but changes for service timestamp, item timestamp, sort order, item state, or item membership changes.

- [ ] **Step 2: Run RED**

Run: `cd apps/control && pnpm exec node scripts/service-planner-contract-selftest.mjs`
Expected: FAIL because planner contracts/revision helper do not exist.

- [ ] **Step 3: Implement the shared policy/contracts**

Add `PLANNER_VIEW_ROLES` in `role-policy.js` as the ten known organization roles and `PLANNER_MUTATION_ROLES` as the explicit five-role array; expose `canViewPlanner` and `canPlanServices` from `roleCapabilities`. In `planner-contracts.ts`, define the controlled statuses/item types and exact limits. In `planner-revision.ts`, compute a SHA-256 revision from a canonical sequence containing service id/`updated_at` and ordered item id/type/sort/state/`updated_at`; return a 24-hex-character non-secret token.

- [ ] **Step 4: Run GREEN and existing RBAC tests**

Run: `cd apps/control && pnpm exec node scripts/service-planner-contract-selftest.mjs && pnpm test:rbac-ui`
Expected: PASS.

- [ ] **Step 5: Wire the self-test into package/CI and commit**

Add `test:service-planner-contract` and a CI step before production build.

Commit: `feat(planner): add shared policy and revision contracts`

---

### Task 2: Organization-scoped service list, create, detail, and metadata update APIs

**Files:**
- Create: `apps/control/src/lib/planner-auth.ts`
- Create: `apps/control/src/lib/planner-service-queries.ts`
- Create: `apps/control/src/app/api/v1/planner/services/route.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/route.ts`
- Create: `apps/control/scripts/service-planner-service-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: `PLANNER_MUTATION_ROLES`, `computePlannerRevision`, existing `auth`, `db`, `query`, `audit_events`, `bible_versions`, campuses and Edge device assignment tables.
- Produces: `requirePlannerSession()`, `loadPlannerServiceScope(client,userId,serviceId)`, `GET/POST /api/v1/planner/services`, `GET/PATCH /api/v1/planner/services/[id]`; detail JSON includes `{service, items, readiness, revision, canEdit, edgeAssignment}` and `ETag: "<revision>"`.

- [ ] **Step 1: Write the failing DB/API integration self-test**

Create isolated organization A/B fixtures. Assert list is membership-scoped and bounded to 50 rows per page; create defaults to `draft`; foreign campus/Bible version is rejected; read-only roles cannot POST/PATCH; planner roles can; detail never returns another organization service; structural metadata updates are allowed in `draft`, a `ready` metadata update demotes to `draft` and clears that service's Edge assignment, while `live/ended/archived` updates are rejected; audit event contains ids/action/high-level metadata but no full cue content.

- [ ] **Step 2: Run RED**

Run: `cd apps/control && pnpm exec node scripts/service-planner-service-selftest.mjs`
Expected: FAIL because planner service routes/helpers do not exist.

- [ ] **Step 3: Implement planner session/scope helpers**

`requirePlannerSession()` returns authenticated user id or a structured 401/403 outcome including forced-password-change handling. `loadPlannerServiceScope(...)` must derive organization from the service row and membership, not a client organization id. Return 404 for out-of-scope service IDs.

- [ ] **Step 4: Implement service list/create/detail/update**

List filters: `upcoming|draft|ready|live|ended|archived`, optional campus, `limit` 1-50, bounded cursor/offset. Creation accepts bounded title, controlled service type, organization campus, optional scheduled start, locally-enabled Bible version. PATCH accepts only editable metadata and requires `If-Match` against the current detail revision. Every successful mutation updates `services.updated_at=clock_timestamp()` and writes bounded audit metadata.

- [ ] **Step 5: Run GREEN plus tenant-isolation regression**

Run the new self-test and existing Control security/self-tests used by CI.
Expected: PASS with foreign service/campus rows never exposed.

- [ ] **Step 6: Wire CI and commit**

Commit: `feat(planner): add scoped service planning APIs`

---

### Task 3: Typed rundown cue schemas and safe planner Preview

**Files:**
- Create: `apps/control/src/lib/planner-item-schemas.ts`
- Create: `apps/control/src/lib/planner-item-normalize.ts`
- Create: `apps/control/src/lib/planner-scripture.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/preview/route.ts`
- Create: `apps/control/scripts/service-planner-item-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: existing `parseOperatorScriptureReference`, Bible tables, `normalizeOperatorPresentationBody`, `normalizeOperatorText`, planner limits.
- Produces: `parsePlannerItemInput(itemType,input)`, `normalizePlannerItem(...) -> {title,content,presentation}`, `resolvePlannerScripture(client, reference, version)`, safe non-mutating Preview endpoint returning `{ok:true,presentation,validation}`.

- [ ] **Step 1: Write RED tests for every item type**

Cover Scripture, Song, Slide, Announcement, Lower Third, Media, Camera, Custom. Assert body/footer limits, 64-section cap, Scripture 80-verse cap, invalid/missing Bible passage, public-domain song fixture normalization, no raw HTML execution fields, custom rejects arbitrary object payloads, media rejects `file:`, `javascript:`, executable/script schemes and unknown source IDs.

- [ ] **Step 2: Run RED**

Run: `cd apps/control && pnpm exec node scripts/service-planner-item-selftest.mjs`
Expected: FAIL because typed schemas/normalizers are absent.

- [ ] **Step 3: Implement Zod typed schemas and normalization**

Each item type has an explicit `.strict()` schema. Persist normalized structured fields plus a presentation-safe `body`/`footer` so the existing Edge catalog can render without a new protocol. Song `body` is the bounded join of ordered sections while retaining `sections` for later section stepping.

- [ ] **Step 4: Implement Scripture resolver reuse and Preview route**

Use the existing canonical parser/book/version tables, not a second parser. Preview authenticates/scopes the service, validates the unsaved payload, and returns normalized presentation only. It does not insert/update a row and does not emit Edge commands.

- [ ] **Step 5: Run GREEN and existing scripture tests**

Run new item test plus `pnpm test:scripture` / current scripture self-tests.
Expected: PASS.

- [ ] **Step 6: Wire CI and commit**

Commit: `feat(planner): add typed cue validation and safe preview`

---

### Task 4: Rundown CRUD, duplicate, transactional reorder, concurrency, and audit

**Files:**
- Create: `apps/control/src/lib/planner-mutations.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/items/route.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/items/[itemId]/route.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/items/[itemId]/duplicate/route.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/reorder/route.ts`
- Create: `apps/control/scripts/service-planner-mutation-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 2 service scope/revision, Task 3 item normalization.
- Produces: transaction helpers `lockEditablePlannerService`, `assertPlannerRevision`, `touchPlannerService`, and CRUD/reorder endpoints. Every response returns the new `revision`/ETag.

- [ ] **Step 1: Write RED DB mutation tests**

Assert create caps service at 200 items; update/delete/duplicate cannot target foreign-service item IDs; all mutations require current `If-Match`; stale revision returns `409 planner_revision_conflict`; duplicate receives a new UUID and is placed immediately after source; reorder rejects missing/extra/duplicate/foreign IDs; rollback leaves old order unchanged after injected failure; audit details exclude full body/lyrics/media URL credentials.

- [ ] **Step 2: Add ready-service invalidation cases to RED test**

Start a valid `ready` service assigned to an Edge device, then perform each persisted planner mutation class (item create/update/delete/duplicate/reorder). Assert the first mutation atomically changes service to `draft`, clears that service's `active_service_id` assignment, and changes `updated_at`. Assert mutations against `live/ended/archived` return `409 service_not_editable`.

- [ ] **Step 3: Run RED**

Expected: planner mutation routes/helpers absent.

- [ ] **Step 4: Implement transaction helpers and CRUD**

Acquire row lock on service, validate organization+role, check status, compute current revision, compare `If-Match`, mutate typed content, renumber only when necessary, `touchPlannerService`, and if the pre-mutation status was `ready` demote to `draft` plus clear Edge assignments for that service before the bounded audit event and commit. On any exception rollback.

- [ ] **Step 5: Implement full-list reorder transaction**

Validate exact current id set, assign temporary non-colliding values if needed, then final `1000,2000,...`; touch service once and audit only old/new id order hashes/counts, not bodies.

- [ ] **Step 6: Run GREEN**

Run mutation test twice to prove idempotent setup/cleanup.
Expected: PASS.

- [ ] **Step 7: Wire CI and commit**

Commit: `feat(planner): add transactional rundown mutations`

---

### Task 5: Readiness validator and lifecycle enforcement on every ready path

**Files:**
- Create: `apps/control/src/lib/planner-readiness.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/ready/route.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/draft/route.ts`
- Modify: `apps/control/src/app/api/v1/services/[id]/state/route.ts`
- Create: `apps/control/scripts/service-planner-readiness-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 3 validators, Task 2/4 scope+transaction helpers.
- Produces: `validatePlannerReadiness(client, serviceId, organizationId): Promise<PlannerReadinessResult>` with bounded `{code,label,itemId?}` issues; atomic ready/draft endpoints; existing service state endpoint calls same validator before `state='ready'`.

- [ ] **Step 1: Write RED readiness tests**

Cover missing scheduled start, disabled/missing Bible version, empty rundown, malformed cue, unresolved Scripture, unsafe media source, >200 items, unsupported item/state, campus/organization mismatch, valid service with zero issues.

- [ ] **Step 2: Add ready-bypass test**

Call both the planner `/ready` endpoint and existing `/api/v1/services/[id]/state` with `state=ready` against the same invalid draft. Both must return `422 readiness_failed` with equivalent issue codes and leave status `draft`.

- [ ] **Step 3: Run RED**

Expected: readiness helper/routes absent and generic state path still permits ready.

- [ ] **Step 4: Implement readiness validator and atomic transitions**

`draft -> ready` locks the service, reruns validation server-side, updates status/timestamps, audits, and preserves the existing eligible-campus Edge auto-assignment behavior only after validation. `ready -> draft` is explicit, audited, and clears `active_service_id` for Edge devices assigned to that service in the same transaction. Keep `live/ended` lifecycle in the existing operational endpoint.

- [ ] **Step 5: Refactor generic service-state ready transition to shared validator**

Do not duplicate issue rules. Preserve live/ended behavior and existing campus advisory locks.

- [ ] **Step 6: Run GREEN and lifecycle regression tests**

Expected: no alternate ready bypass.

- [ ] **Step 7: Wire CI and commit**

Commit: `feat(planner): enforce service readiness lifecycle`

---

### Task 6: Planner service list/create UI and role-aware navigation

**Files:**
- Create: `apps/control/src/app/planner/page.tsx`
- Create: `apps/control/src/components/planner/ServicePlannerList.tsx`
- Create: `apps/control/src/components/planner/CreateServiceDialog.tsx`
- Modify: `apps/control/src/app/page.tsx`
- Modify: `apps/control/src/lib/role-capabilities.ts`
- Create: `apps/control/scripts/service-planner-ui-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 1 `canPlanServices`, Task 2 service APIs.
- Produces: `/planner` service list/create experience; read-only users may see permitted service summary but mutation affordances are absent; planner roles see Create/Edit links.

- [ ] **Step 1: Write RED UI contract test**

Assert Control Room navigation shows Planner to every role in `PLANNER_VIEW_ROLES`, Create/Edit/Ready affordances are gated to `canPlanServices`, filters are present, organization timezone is used for scheduled display, and no horizontal overflow-prone fixed widths are introduced.

- [ ] **Step 2: Run RED**

Expected: `/planner` and components absent.

- [ ] **Step 3: Implement server page + client list/create components**

Use server-side session for initial capability and a client component only for filters/dialog interactions. Create form fields exactly match spec and handle 400/403/409 safely. On success navigate to `/planner/<serviceId>`.

- [ ] **Step 4: Run UI self-test, lint, production build**

Run: `pnpm test:service-planner-ui && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(planner): add service planning entry point`

---

### Task 7: Three-pane Service Planner workspace and typed cue editors

**Files:**
- Create: `apps/control/src/app/planner/[id]/page.tsx`
- Create: `apps/control/src/components/planner/ServicePlannerWorkspace.tsx`
- Create: `apps/control/src/components/planner/RundownList.tsx`
- Create: `apps/control/src/components/planner/CueEditor.tsx`
- Create: `apps/control/src/components/planner/editors/ScriptureCueEditor.tsx`
- Create: `apps/control/src/components/planner/editors/SongCueEditor.tsx`
- Create: `apps/control/src/components/planner/editors/TextCueEditor.tsx`
- Create: `apps/control/src/components/planner/editors/LowerThirdCueEditor.tsx`
- Create: `apps/control/src/components/planner/editors/MediaCueEditor.tsx`
- Create: `apps/control/src/components/planner/editors/CameraCueEditor.tsx`
- Create: `apps/control/src/components/planner/CuePreview.tsx`
- Update: `apps/control/scripts/service-planner-ui-selftest.mjs`

**Interfaces:**
- Consumes: Task 2 detail API, Task 3 Preview, Task 4 item CRUD.
- Produces: typed authoring UI with left ordered list, center editor, right safe preview; no raw JSON editor.

- [ ] **Step 1: Extend RED UI contract tests**

Assert all eight item types are selectable, raw JSON textarea is absent, Scripture reference/version fields exist, Song sections support add/remove/reorder up to 64, media uses approved source selector rather than free-form path, and Preview calls planner Preview API rather than Edge Program APIs.

- [ ] **Step 2: Run RED**

Expected: planner detail/workspace components absent.

- [ ] **Step 3: Implement workspace shell and typed editors**

Keep component responsibility small: `CueEditor` dispatches by type; editors emit typed draft values; workspace owns selected item, save/duplicate/delete/preview actions and latest revision token.

- [ ] **Step 4: Implement responsive behavior**

Desktop uses three columns; narrow viewport switches to stacked/tabbed regions. Preserve readable font/button sizing and visible focus states.

- [ ] **Step 5: Run UI tests, lint, build**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat(planner): add typed rundown authoring workspace`

---

### Task 8: Accessible reorder, readiness panel, optimistic-conflict recovery, and audit hints

**Files:**
- Modify: `apps/control/src/components/planner/RundownList.tsx`
- Create: `apps/control/src/components/planner/ReadinessPanel.tsx`
- Modify: `apps/control/src/components/planner/ServicePlannerWorkspace.tsx`
- Update: `apps/control/scripts/service-planner-ui-selftest.mjs`

**Interfaces:**
- Consumes: Task 4 reorder/revision API, Task 5 readiness/ready/draft API.
- Produces: drag reorder + keyboard Move Up/Down, Ready for service workflow, `409` reload/reconcile UX, issue-to-cue navigation.

- [ ] **Step 1: Add RED tests for interaction contract**

Assert reorder posts one complete id list, Move Up/Down exists independent of drag, Save/Ready disabled for read-only users, readiness issue item IDs focus the cue, `409 planner_revision_conflict` shows refresh/reload action instead of silently retrying, and successful server response replaces local revision.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement drag + keyboard ordering**

Use pointer drag implementation already available in React/DOM primitives unless an existing dependency is present; do not add a large drag library solely for this slice. Optimistic visual order is reverted on server failure.

- [ ] **Step 4: Implement readiness/conflict UX**

Ready action always calls server readiness route; issue list links to affected cue. On `409`, freeze local mutation actions until user refreshes/reloads latest server state.

- [ ] **Step 5: Run UI tests, lint, build**

- [ ] **Step 6: Commit**

Commit: `feat(planner): add readiness and resilient rundown ordering`

---

### Task 9: Prove planner-to-Edge catalog compatibility and ready/live-only synchronization

**Files:**
- Modify: `apps/control/scripts/edge-operator-catalog-selftest.mjs`
- Modify if required by typed content: `apps/control/src/lib/edge-operator-catalog.ts`
- Modify if required by revision source: `apps/control/src/app/api/v1/edge/operator/catalog/route.ts`
- Update: `apps/control/scripts/service-planner-mutation-selftest.mjs`

**Interfaces:**
- Consumes: planner-persisted typed content and existing Edge catalog endpoint.
- Produces: no new cloud protocol; proves planner data normalizes into existing `{itemId,itemType,title,body,footer,metadata}` contract and revision changes on every planner mutation.

- [ ] **Step 1: Write RED integration assertions using planner-created rows**

Create a ready service with all supported cue types via planner normalizers, assign an Edge device, and assert catalog order/body/footer match planner order. Assert draft service returns no active catalog, ready/live returns catalog, demotion to draft removes it, and reorder/edit/delete changes `catalogRevision`.

- [ ] **Step 2: Add typed-content compatibility cases**

Song structured sections must produce the stored normalized body; lower third/custom/media fields must not leak unsafe metadata. Catalog remains capped at 200.

- [ ] **Step 3: Run RED if any compatibility gap exists**

If tests are already green with no production change, keep this as a proof-only commit. If normalization is missing, make the minimal extractor adjustment without changing the endpoint schema.

- [ ] **Step 4: Run catalog + planner mutation/readiness self-tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(planner): prove Edge catalog rundown synchronization`

---

### Task 10: Desktop Order of Service current/preview/next semantics and safe auto-advance

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/OperatorRundownNavigator.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/OperatorWorkspaceCatalog.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/OperatorRundownNavigatorTests.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/OperatorWorkspaceCatalogTests.cs`

**Interfaces:**
- Consumes: existing `LocalOperatorSnapshot.Preview`, `.Program`, `OperatorWorkspaceItem.Id`, `LocalOperatorClient` Preview/Take/Clear acknowledgements.
- Produces: `OperatorRundownState`/`OperatorRundownNavigator` mapping cached items + runtime snapshot to sequence/current/preview/next indicators and `AdvanceAfterSuccessfulTake(currentSelectionId, programItemId)`.

- [ ] **Step 1: Write RED xUnit tests**

Test sequence numbering; Program ID maps to `CURRENT`; Preview maps independently; `NEXT` is cue after current when current is in rundown; successful Take advances selection one cue only; failed Take does not move; last cue stays selected; ad-hoc Program ID not in rundown yields `Ad-hoc Program` and preserves selection; filtered view does not redefine canonical sequence/current order.

- [ ] **Step 2: Run RED in GitHub/SDK-capable environment**

Run: `dotnet test apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/iPresenterPlux.Edge.Desktop.Tests.csproj`
Expected: FAIL because navigator/state types do not exist.

- [ ] **Step 3: Implement pure navigator/state first**

Keep all item/snapshot logic outside Avalonia controls so tests do not require UI automation.

- [ ] **Step 4: Wire MainWindow presentation**

Left pane heading becomes `Order of Service` for synced services; rows show sequence/type/title and current/Preview/Next badges; existing cache-state/service title remain. Preview/Take/Clear commands remain unchanged. After `ProgramTake` returns `Ok=true`, update selection using navigator; do not automatically Preview or Take the next cue.

- [ ] **Step 5: Add safe keyboard selection navigation**

Add previous/next selection shortcuts only when focus is not in a text entry control; preserve existing Take/Clear shortcuts and accessible focus order.

- [ ] **Step 6: Run full desktop/core tests**

Run Desktop and Core test projects on Windows/macOS CI. Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `feat(desktop): add Order of Service operator navigation`

---

### Task 11: Full regression, documentation, CI artifacts, and production deployment verification

**Files:**
- Modify: `apps/control/README.md` or root `README.md` planner section as appropriate
- Modify: `apps/edge-agent/README.md` Operator workspace section
- Modify: `docs/architecture.md` only if the planner authoring/read-model relationship is not already represented
- No feature code unless verification exposes a defect.

**Interfaces:**
- Consumes: Tasks 1-10.
- Produces: documented production workflow and verified Windows/macOS artifacts.

- [ ] **Step 1: Run complete Control Portal gate**

Run the existing full self-test suite including all new `test:service-planner-*`, demo accounts, RBAC, scripture, stream security/provider health, MediaMTX validation, `pnpm lint`, and `pnpm build`.
Expected: all PASS.

- [ ] **Step 2: Run complete Edge CI gate**

Windows and macOS: Desktop tests, Core tests, platform builds, native bridge verification, pinned libsrt build/verification, self-contained desktop publish, MediaMTX SRT smoke, artifact upload.
Expected: both jobs success.

- [ ] **Step 3: Perform pre-merge diff/security review**

Confirm no planner API trusts client organization ids, no route bypasses readiness, no planner content adds raw HTML/script execution, no desktop DTO gains credential fields, no loopback mutation route appears, audit details are bounded, and role arrays are not broadened.

- [ ] **Step 4: Merge only the fully verified head**

Require green Control + Edge CI on the exact head SHA.

- [ ] **Step 5: Deploy Control Plane**

Fast-forward the clean VPS `main`, run production build, restart `ipresenterplux.service`, and verify local/public `/api/v1/health` HTTP 200 plus planner routes requiring authentication.

- [ ] **Step 6: Verify live planner smoke without destructive Program output**

Using a demo planner role, create a draft test service, add public-domain Scripture/slide/song cues, reorder, validate, mark ready, confirm catalog revision/Edge cache receives ordered cues, then return/delete/archive the test fixture according to available lifecycle without sending Program live.

- [ ] **Step 7: Verify desktop artifact**

Download the Windows artifact from the exact green run, verify archive integrity/digest and root `iPresenterPlux.Edge.Desktop.exe`. On the real paired workstation UAT, confirm Order of Service current/Preview/Next and offline cache behavior when that workstation is available.

- [ ] **Step 8: Update milestone issue/PR notes and clean worktree**

Record external UAT blockers separately rather than claiming them complete; remove temporary worktree after merge.

Commit documentation before final merge if documentation changes are needed: `docs: document Service Planner and Order of Service`
