# Intelligent Service Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card-heavy default Control Room/standalone Operator mental model with one AI-native Cockpit that keeps Program/Preview/Next/Attention central, adds Focus Mode, Predictive Next, typed commands, plain-language recovery, and role-specific mobile projections without weakening existing safety boundaries.

**Architecture:** Add one server-side Cockpit projection over existing authoritative domain services, then render it through a shared Cockpit workspace used by `/` and `/operator`. Predictive Next persists service-scoped recommendations and pins while Program mutations continue through existing Scripture/Planner/Edge paths. Commands resolve only to registered typed intents, attention is computed from existing health truth, and responsive role projections share the same server model instead of duplicating domain state.

**Tech Stack:** Next.js 16.3.8 App Router, React 19, TypeScript 5, PostgreSQL 17, `pg`, Tailwind CSS 4, Lucide React, Node 22 self-tests, existing RBAC/licensing/Planner/Scripture/Edge APIs.

**Spec:** `docs/superpowers/specs/2026-10-08-intelligent-service-cockpit-design.md`

## Global Constraints

- Program remains deliberate: AI/recommendations/commands may prepare Preview but never mutate Program directly.
- Preview -> Program remains the universal safety boundary for presentable content.
- Physical camera/audio/output truth remains Edge-owned; the browser must not claim local capture authority.
- Role permissions and subscription entitlements remain independent server-enforced gates.
- Focus Mode changes presentation only; it cannot grant authority.
- Healthy subsystem telemetry recedes; actionable failures state impact and recovery first.
- Existing domain workspaces and routes stay available for deep work and compatibility.
- Database-writing self-tests must remain blocked against production databases.
- No new product secrets, provider credentials, or activation material may enter Git/browser payloads/logs.
- Preserve all currently green Scripture, Planner, Audience/Streaming, licensing, Operator, Studio Workspace, production-build and route-manifest gates.

## Review Focus

- **Stale live context:** if service/Edge/recommendation timestamps are stale, Cockpit must degrade/expire them rather than present them as current; Task 1 and Task 4 tests pin this.
- **Competing operators:** one operator pin/dismiss must produce deterministic shared service state rather than local-only divergence; Task 4 tests pin transactional/idempotent behavior.
- **Ambiguous commands:** consequential intents must require explicit interpretation/confirmation and never guess a live mutation; Task 6 tests pin this.
- **Entitlement/role changes mid-service:** visual depth or Focus Mode must not retain capabilities after server authority changes; Task 3 and Task 8 tests pin fresh server gating.
- **Contained failures:** a provider/worker failure must identify unaffected Program/audience paths and never trigger a recovery action that worsens a contained failure; Task 7 tests pin impact/containment/recovery mapping.

## File Structure

- `apps/control/src/lib/cockpit/contracts.ts` — shared Cockpit, Next, Attention and command-facing types.
- `apps/control/src/lib/cockpit/view-model.ts` — server projection from authoritative service/domain state.
- `apps/control/src/lib/cockpit/recommendations.ts` — service-scoped Predictive Next persistence/ranking/freshness/actions.
- `apps/control/src/lib/cockpit/commands.ts` — typed intent registry, deterministic resolution and authorization-safe execution delegation.
- `apps/control/src/lib/cockpit/attention.ts` — normalized impact/containment/recovery projection from existing health truth.
- `apps/control/src/lib/cockpit/role-projection.ts` — producer/pastor/interpreter/media-lead view projection without capability escalation.
- `apps/control/src/components/cockpit/*` — shared desktop/mobile Cockpit UI, Program/Preview stage, Now/Next rails, Focus Mode, command palette and attention layer.
- `apps/control/src/app/api/v1/cockpit/*` — recommendation/pin/command actions only; no arbitrary domain-table writes.
- `apps/control/db/040_cockpit_recommendations.sql` — recommendation and operator-pin persistence.
- `apps/control/scripts/cockpit-*-selftest.mjs` — contract/integration/safety/acceptance tests.

---

### Task 1: Cockpit Contracts and Authoritative View Model

**Files:**
- Create: `apps/control/src/lib/cockpit/contracts.ts`
- Create: `apps/control/src/lib/cockpit/view-model.ts`
- Create: `apps/control/scripts/cockpit-view-model-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `apps/control/scripts/db-selftest-safety-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: `getCurrentServiceForUser(userId, options)`, existing Planner/Scripture/stream/language/media-source/Edge tables.
- Produces: `getCockpitViewModel(client, userId, options) -> Promise<CockpitViewModel>` and stable exported types `CockpitViewModel`, `CockpitProgramState`, `CockpitPreviewState`, `CockpitNowContext`, `CockpitNextItem`, `CockpitAttentionItem`.

- [ ] **Step 1: Write the failing PostgreSQL-backed contract test**

Add assertions that `getCockpitViewModel()` returns the current live service before ready, authoritative Program and Preview separately, latest speaker/transcript context, current Planner neighborhood, summaries for camera/output/languages/audience, role + entitlement capabilities, and marks stale Edge/source context non-current at the spec freshness boundary.

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-view-model`
Expected: FAIL because `src/lib/cockpit/view-model.ts` does not exist.

- [ ] **Step 3: Implement the contracts and read-only view model**

Implement `getCockpitViewModel(client: PoolClient, userId: string, options?: { organizationId?: string; now?: Date }): Promise<CockpitViewModel>` by composing existing authoritative rows/services only. Do not create copied domain state or any Program mutation path.

- [ ] **Step 4: Verify GREEN and neighboring service-context tests**

Run: `pnpm --dir apps/control test:cockpit-view-model && pnpm --dir apps/control test:studio-route-gating && pnpm --dir apps/control test:operator-workspace && pnpm --dir apps/control test:db-selftest-safety`
Expected: all PASS; DB safety count increases for the writable fixture test if it writes setup rows.

- [ ] **Step 5: Commit**

```bash
git add apps/control/src/lib/cockpit apps/control/scripts/cockpit-view-model-selftest.mjs apps/control/package.json apps/control/scripts/db-selftest-safety-selftest.mjs .github/workflows/control-ci.yml
git commit -m "feat(control): add authoritative cockpit view model"
```

### Task 2: Unified Cockpit Shell and Program/Preview/Now/Next Layout

**Files:**
- Create: `apps/control/src/components/cockpit/CockpitWorkspace.tsx`
- Create: `apps/control/src/components/cockpit/ProgramPreviewStage.tsx`
- Create: `apps/control/src/components/cockpit/NowRail.tsx`
- Create: `apps/control/src/components/cockpit/NextRail.tsx`
- Create: `apps/control/src/components/cockpit/CockpitHeader.tsx`
- Modify: `apps/control/src/app/DashboardPage.tsx`
- Modify: `apps/control/src/app/operator/page.tsx`
- Create: `apps/control/scripts/cockpit-shell-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: `CockpitViewModel` from Task 1 and existing Scripture/Planner live mutation APIs.
- Produces: `CockpitWorkspace({ model, initialFocusMode? })` used by both Control Room and Operator compatibility route.

- [ ] **Step 1: Write the failing shell test**

Assert the default page renders one shared `CockpitWorkspace`; `/operator` uses that same workspace instead of the standalone `ScriptureOperatorWorkspace`; Program is visually dominant; Preview is adjacent; TAKE/Clear remain explicit; Now/Next exist; existing domain routes remain reachable; no dashboard KPI-card grid is required for normal operation.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-shell`
Expected: FAIL because the shared Cockpit components do not exist and Dashboard still renders the legacy card-heavy layout.

- [ ] **Step 3: Implement shared Cockpit rendering**

Move only live-operating presentation into focused components. Reuse existing state APIs and keep cloud intent vs Edge confirmation distinct. `/operator` must remain a compatibility entry to the same Cockpit mental model, not a second UI architecture.

- [ ] **Step 4: Verify shell, Operator and production build**

Run: `pnpm --dir apps/control test:cockpit-shell && pnpm --dir apps/control test:operator-workspace && pnpm --dir apps/control lint && pnpm --dir apps/control build`
Expected: PASS and existing route manifest still contains `/`, `/operator`, `/scripture`, `/media`, `/cameras`, `/streaming`, `/audience`, `/archive`, `/settings`.

- [ ] **Step 5: Commit**

```bash
git add apps/control/src/components/cockpit apps/control/src/app/DashboardPage.tsx apps/control/src/app/operator/page.tsx apps/control/scripts/cockpit-shell-selftest.mjs apps/control/package.json .github/workflows/control-ci.yml
git commit -m "feat(control): unify live operation in service cockpit"
```

### Task 3: Focus Mode and Progressive Depth

**Files:**
- Create: `apps/control/src/components/cockpit/FocusMode.tsx`
- Create: `apps/control/src/components/cockpit/CockpitDepthControls.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitWorkspace.tsx`
- Create: `apps/control/scripts/cockpit-focus-mode-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: `CockpitViewModel`; no new backend authority.
- Produces: presentation states `essential | advanced | engineering` and Focus Mode with identical server capabilities to the non-focus Cockpit.

- [ ] **Step 1: Write the failing Focus/depth test**

Assert Focus Mode contains only Program, Preview, Next, TAKE, Clear, minimal Now, one Attention trigger and command trigger; no hover-only action is required; Essential hides engineering telemetry; Advanced/Engineering may reveal detail but cannot cause buttons to appear when server capabilities deny them; capability removal on refreshed model removes actions even if the previous depth showed them.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-focus`
Expected: FAIL because Focus/depth components do not exist.

- [ ] **Step 3: Implement presentation-only Focus/depth state**

Use client presentation state persisted per operator/device only for view preference. Never persist authorization or infer capability from the chosen depth.

- [ ] **Step 4: Verify keyboard/touch/safety regressions**

Run: `pnpm --dir apps/control test:cockpit-focus && pnpm --dir apps/control test:operator-workspace && pnpm --dir apps/control test:rbac-ui && pnpm --dir apps/control lint`
Expected: PASS; existing Preview/Take/Clear keyboard contract remains unchanged or is intentionally mapped through the same safe handlers.

- [ ] **Step 5: Commit**

```bash
git add apps/control/src/components/cockpit apps/control/scripts/cockpit-focus-mode-selftest.mjs apps/control/package.json .github/workflows/control-ci.yml
git commit -m "feat(control): add cockpit focus mode and progressive depth"
```

### Task 4: Durable Predictive Next Recommendation and Pin Contract

**Files:**
- Create: `apps/control/db/040_cockpit_recommendations.sql`
- Create: `apps/control/src/lib/cockpit/recommendations.ts`
- Create: `apps/control/src/app/api/v1/cockpit/recommendations/[id]/route.ts`
- Create: `apps/control/src/app/api/v1/cockpit/pins/route.ts`
- Create: `apps/control/scripts/cockpit-recommendations-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `apps/control/scripts/db-selftest-safety-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: existing service/tenant IDs, `CockpitNextItem` contract, existing audit events and Preview-capable domain operations.
- Produces: `listCockpitRecommendations()`, `upsertCockpitRecommendation()`, `setCockpitRecommendationState()`, `listServicePins()`, `setServicePin()`; recommendation states `suggested | prepared | accepted | dismissed | expired`.

- [ ] **Step 1: Write the failing migration/service test**

Assert migration `040` creates organization/service-scoped recommendation persistence with target/payload, confidence, reason/evidence, source observed time, expiry, state, optional Preview/result linkage and timestamps; create a generic service pin record keyed by service + target type + target ID. Test cross-organization denial, idempotent upsert for the same source identity, deterministic ordering, stale expiry, shared operator pin visibility, repeated dismiss/pin idempotency and audit rows.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-recommendations`
Expected: FAIL because migration/service do not exist.

- [ ] **Step 3: Implement migration and recommendation service**

Use exact exported signatures:

```ts
listCockpitRecommendations(client, input): Promise<CockpitRecommendation[]>
upsertCockpitRecommendation(client, input): Promise<CockpitRecommendation>
setCockpitRecommendationState(client, actorUserId, input): Promise<CockpitRecommendation>
listServicePins(client, input): Promise<CockpitServicePin[]>
setServicePin(client, actorUserId, input): Promise<CockpitServicePin | null>
```

State transitions must never call Program mutation. `prepared` may reference a Preview/result produced by an existing authorized domain operation.

- [ ] **Step 4: Verify DB safety + recommendation behavior**

Run: `pnpm --dir apps/control test:cockpit-recommendations && pnpm --dir apps/control test:db-selftest-safety && pnpm --dir apps/control test:ai-director`
Expected: PASS, including stale recommendations becoming non-actionable and pins shared across operators.

- [ ] **Step 5: Commit**

```bash
git add apps/control/db/040_cockpit_recommendations.sql apps/control/src/lib/cockpit/recommendations.ts apps/control/src/app/api/v1/cockpit apps/control/scripts/cockpit-recommendations-selftest.mjs apps/control/package.json apps/control/scripts/db-selftest-safety-selftest.mjs .github/workflows/control-ci.yml
git commit -m "feat(control): add predictive next recommendation contract"
```

### Task 5: Predictive Next Sources and Operator Actions

**Files:**
- Create: `apps/control/src/lib/cockpit/predictive-next.ts`
- Modify: `apps/control/src/lib/cockpit/view-model.ts`
- Modify: `apps/control/src/components/cockpit/NextRail.tsx`
- Create: `apps/control/src/components/cockpit/NextItemActions.tsx`
- Create: `apps/control/scripts/cockpit-predictive-next-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 4 recommendation/pin services, Scripture detections, nearby Planner items, Media library/service items, Edge camera truth.
- Produces: `projectPredictiveNext(client, input) -> Promise<CockpitNextItem[]>` with ranked sources `planned | recommendation | pinned` and actions `preview | open | pin | dismiss | use_instead` as allowed by each item.

- [ ] **Step 1: Write the failing ranking/freshness/safety test**

Create equal-input fixtures and assert deterministic ordering, fresh Scripture recommendation confidence/evidence, planned-item neighborhood inclusion, manual pins above ordinary suggestions, stale Scripture/camera suggestions expire, camera suggestions require fresh Edge truth, dismissed items stay dismissed, and no action descriptor is `program.show` or equivalent.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-predictive-next`
Expected: FAIL because `predictive-next.ts` does not exist.

- [ ] **Step 3: Implement phased recommendation sources**

Implement Scripture first from existing confidence/evidence, Planner/media second from current rundown/library context, and camera recommendations only when Edge source freshness/availability is valid. Reuse Task 4 persistence rather than creating React-only recommendations.

- [ ] **Step 4: Wire Next rail actions to existing safe domain operations**

`Preview` must call the same authorized Scripture/Planner preparation path already used by normal workspaces. `Pin`/`Dismiss` use Task 4 APIs. `Open` deep-links to the owning workspace. `Use instead` changes selection/recommendation priority only; it does not mutate Program.

- [ ] **Step 5: Verify Predictive Next + Program safety**

Run: `pnpm --dir apps/control test:cockpit-predictive-next && pnpm --dir apps/control test:operator-workspace && pnpm --dir apps/control test:scripture-workspace-ui && pnpm --dir apps/control test:media-workspace`
Expected: PASS and the test explicitly proves no recommendation path calls Program directly.

- [ ] **Step 6: Commit**

```bash
git add apps/control/src/lib/cockpit apps/control/src/components/cockpit apps/control/scripts/cockpit-predictive-next-selftest.mjs apps/control/package.json .github/workflows/control-ci.yml
git commit -m "feat(control): add predictive next operator flow"
```

### Task 6: Typed AI Command Layer

**Files:**
- Create: `apps/control/src/lib/cockpit/commands.ts`
- Create: `apps/control/src/app/api/v1/cockpit/command/route.ts`
- Create: `apps/control/src/components/cockpit/CommandPalette.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitWorkspace.tsx`
- Modify: `apps/control/src/components/cockpit/FocusMode.tsx`
- Create: `apps/control/scripts/cockpit-command-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: typed domain operations and server capabilities; Task 4/5 recommendation preparation where appropriate.
- Produces: `resolveCockpitCommand(text, context) -> CockpitCommandResolution`, `executeCockpitIntent(client, actorUserId, intent) -> CockpitCommandResult`, intent IDs initially limited to `navigation.open`, `scripture.search`, `scripture.preview`, `media.search`, `media.open`, `recommendation.pin`, `recommendation.dismiss`, `status.explain`.

- [ ] **Step 1: Write the failing resolver/authorization test**

Assert deterministic phrases such as `Show John 3:16 NIV` resolve to an explicit Scripture preparation intent, `Find Amazing Grace` resolves to media search, `What is wrong with streaming?` resolves to read-only status explanation, unknown text yields a non-mutating fallback, ambiguous consequential text returns `needs_confirmation`, and no registered intent maps directly to Program, arbitrary SQL/tool execution, device credential operations or an unentitled capability.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-command`
Expected: FAIL because the command registry/resolver do not exist.

- [ ] **Step 3: Implement deterministic typed intent registry first**

Implement exact types `CockpitIntent`, `CockpitCommandResolution`, `CockpitCommandResult`. Natural-language parsing may use deterministic token/reference matching in this phase; do not add an LLM dependency. Execution delegates to existing safe services/API helpers only.

- [ ] **Step 4: Add palette UI with interpretation preview**

Show command interpretation before consequential preparation when ambiguity exists. Low-risk navigation/search/read may execute immediately. Keyboard trigger must work from Cockpit and Focus Mode without stealing focus from text fields.

- [ ] **Step 5: Verify command safety + entitlement changes**

Run: `pnpm --dir apps/control test:cockpit-command && pnpm --dir apps/control test:entitlement-gating && pnpm --dir apps/control test:rbac-ui && pnpm --dir apps/control lint`
Expected: PASS; a role/entitlement removed between render and execution is denied by server execution even if the client still shows the old command result.

- [ ] **Step 6: Commit**

```bash
git add apps/control/src/lib/cockpit/commands.ts apps/control/src/app/api/v1/cockpit/command apps/control/src/components/cockpit apps/control/scripts/cockpit-command-selftest.mjs apps/control/package.json .github/workflows/control-ci.yml
git commit -m "feat(control): add typed cockpit command layer"
```

### Task 7: Smart Attention and Recovery Projection

**Files:**
- Create: `apps/control/src/lib/cockpit/attention.ts`
- Create: `apps/control/src/components/cockpit/AttentionLayer.tsx`
- Modify: `apps/control/src/lib/cockpit/view-model.ts`
- Modify: `apps/control/src/components/cockpit/CockpitWorkspace.tsx`
- Modify: `apps/control/src/components/cockpit/FocusMode.tsx`
- Create: `apps/control/scripts/cockpit-attention-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: existing Edge/media-source freshness, ASR metadata, translation/TTS worker health, stream/provider/session state, entitlement grace status.
- Produces: `buildCockpitAttention(input) -> CockpitAttentionItem[]`; each item has `severity`, `affectedCapability`, `impact`, `containment`, `recommendedAction`, `detailHref`, `observedAt`, `freshUntil`, and optional `recoveryIntent` restricted to registered idempotent/safe actions.

- [ ] **Step 1: Write the failing incident-mapping test**

Pin the spec examples: Edge offline explains affected local capabilities; ASR degraded says manual Scripture/Media remains available; translation/TTS failure lists affected language path while original remains available; social stream failure states local Program/other destinations remain healthy; entitlement renewal failure shows grace and keeps stop/read/history/settings. Assert every amber/red item has impact + recommendation and stale healthy incidents disappear.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-attention`
Expected: FAIL because attention projection does not exist.

- [ ] **Step 3: Implement normalized attention projection**

Compute first-phase incidents from existing telemetry; do not add a durable incident table. Recovery actions must either deep-link to the owning workspace or invoke an existing idempotent/safe typed intent. Never auto-restart/stop unrelated healthy systems.

- [ ] **Step 4: Implement quiet ambient health + expandable attention UI**

Healthy state is one compact ambient indicator. Only actionable warnings expand. Engineering detail is behind explicit expansion; Focus Mode still shows one attention trigger without telemetry walls.

- [ ] **Step 5: Verify containment and neighboring stream/translation regressions**

Run: `pnpm --dir apps/control test:cockpit-attention && pnpm --dir apps/control test:streaming-studio-recovery && pnpm --dir apps/control test:stream-provider-health && pnpm --dir apps/control test:transcript-window`
Expected: PASS and provider/worker failures do not alter unrelated Program/destination state.

- [ ] **Step 6: Commit**

```bash
git add apps/control/src/lib/cockpit/attention.ts apps/control/src/lib/cockpit/view-model.ts apps/control/src/components/cockpit apps/control/scripts/cockpit-attention-selftest.mjs apps/control/package.json .github/workflows/control-ci.yml
git commit -m "feat(control): add smart attention and recovery guidance"
```

### Task 8: Role-Specific Mobile Projections and Final Cockpit Acceptance

**Files:**
- Create: `apps/control/src/lib/cockpit/role-projection.ts`
- Create: `apps/control/src/components/cockpit/CockpitMobile.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitWorkspace.tsx`
- Modify: `apps/control/src/components/navigation/StudioMobileNav.tsx`
- Create: `apps/control/scripts/cockpit-role-projection-selftest.mjs`
- Create: `apps/control/scripts/cockpit-acceptance-selftest.mjs`
- Modify: `apps/control/scripts/studio-route-manifest-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: `CockpitViewModel`, role capabilities and entitlements; does not create independent mobile state.
- Produces: `projectCockpitForRole(model, roles) -> CockpitRoleProjection` with UX projection kinds `producer`, `pastor_service_leader`, `interpreter`, `media_lead`, plus a default restricted projection. These are presentation profiles only: derive them from existing role IDs/capabilities (`owner`, `admin`, `pastor`, `presenter_operator`, `media_operator`, `translator`, etc.); do not add or reinterpret authorization roles.

- [ ] **Step 1: Write failing role-projection tests**

Assert a producer projection derived from `presenter_operator`/`media_operator`/admin capabilities gets Program/Preview/Next/Attention and only authorized live controls; `pastor` gets current/next rundown + Scripture/request/pin with no extra engineering authority; `translator` gets assigned language/transcript/source/translation health; `media_operator` gets queued assets/camera-media readiness while still obeying its existing permissions; changing visual depth never adds capabilities; audience remains on `/live`, not the private Cockpit projection.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/control test:cockpit-role-projection`
Expected: FAIL because role projection does not exist.

- [ ] **Step 3: Implement role projection and task-specific mobile UI**

Use one authoritative model and filter presentation/actions by server capabilities. Mobile must not be a compressed copy of the desktop Engineering layout.

- [ ] **Step 4: Add final Cockpit acceptance gate**

`cockpit-acceptance-selftest.mjs` must assert: shared `/` + `/operator` Cockpit mental model; Program/Preview are the largest and immediately distinguishable live surfaces; Focus Mode controls; Next recommendation safety; typed-command registry with no direct Program intent; impact/recovery on all attention items; role-specific mobile projections; pointer/focus/touch targets; no hover-only primary action; healthy telemetry is not rendered as a permanent KPI-card wall; no dead primary live controls; and domain routes are preserved.

- [ ] **Step 5: Run complete committed-tree candidate verification**

Run at minimum:

```bash
pnpm --dir apps/control test:cockpit-view-model
pnpm --dir apps/control test:cockpit-shell
pnpm --dir apps/control test:cockpit-focus
pnpm --dir apps/control test:cockpit-recommendations
pnpm --dir apps/control test:cockpit-predictive-next
pnpm --dir apps/control test:cockpit-command
pnpm --dir apps/control test:cockpit-attention
pnpm --dir apps/control test:cockpit-role-projection
pnpm --dir apps/control test:cockpit-acceptance
pnpm --dir apps/control test:operator-workspace
pnpm --dir apps/control test:studio-navigation
pnpm --dir apps/control test:studio-route-gating
pnpm --dir apps/control test:entitlement-gating
pnpm --dir apps/control test:db-selftest-safety
pnpm --dir apps/control lint
pnpm --dir apps/control build
pnpm --dir apps/control test:studio-route-manifest
git diff --check origin/feat/studio-workspaces..HEAD
```

Expected: all PASS. Then push the branch and require full GitHub Control Portal CI including every inherited gate before integration.

- [ ] **Step 6: Commit**

```bash
git add apps/control/src/lib/cockpit/role-projection.ts apps/control/src/components/cockpit apps/control/src/components/navigation/StudioMobileNav.tsx apps/control/scripts/cockpit-role-projection-selftest.mjs apps/control/scripts/cockpit-acceptance-selftest.mjs apps/control/scripts/studio-route-manifest-selftest.mjs apps/control/package.json .github/workflows/control-ci.yml
git commit -m "ci(control): gate intelligent service cockpit"
```

## Execution Boundaries

- Implement on a new feature worktree created from the approved design branch or the final green Studio head after integration strategy is chosen; do not edit production checkout directly.
- Keep each task in its own commit and require its targeted tests before beginning the next task.
- GitHub CI remains the authority for writable PostgreSQL integration when local isolated PostgreSQL is unavailable.
- Do not merge/deploy until the full inherited + Cockpit CI matrix is green and the stacked PR order is resolved.
- Field UAT follows code/CI completion and must execute all ten scenarios from the spec before calling the experience commercially ready.
