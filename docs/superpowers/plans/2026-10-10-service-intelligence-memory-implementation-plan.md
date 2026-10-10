# Service Intelligence and Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved `Prepare -> Assist -> Preview -> Program -> Remember` loop by turning sermon/service notes and previous services into safe preparation suggestions before service, then turning every ended service into structured, searchable production memory afterward.

**Architecture:** Add tenant-scoped preparation-note and service-memory tables beside existing Planner/Archive truth. Preparation is a read projection over notes, prior ended services, Media Library, Planner, configured outputs/languages and Edge readiness; applying a suggestion always delegates to existing Planner mutations. Memory generation is deterministic and bounded from existing transcript, Scripture, rundown, speaker, translation, stream/output and artifact data so ending a service never depends on an external AI provider; a future provider can enrich the same contracts without becoming authoritative.

**Tech Stack:** Next.js 16.3.8, React 19, TypeScript 5, PostgreSQL 18-compatible SQL, `pg`, existing Planner/Archive/Cockpit/Transcript/Scripture/Media services, Node 22 self-tests.

**Spec:** `docs/superpowers/specs/2026-10-08-intelligent-service-cockpit-design.md`

## Global Constraints

- Keep Program authority unchanged: preparation and memory code cannot Take/Clear Program.
- Preparation may suggest; changing the rundown requires an explicit authorized operator action through existing Planner mutation services.
- Service ending must succeed even if memory generation fails; memory failure is visible/retryable and audited.
- No external LLM/provider is required for correctness, service ending, Archive access or search.
- All notes/memory are organization-scoped and membership/RBAC checked server-side.
- Audience/public endpoints must never expose private sermon notes or private service-memory metadata.
- Existing transcript/Scripture/rundown/artifact rows remain authoritative; memory stores derived summaries/indexes, not competing live state.
- Generated memory is idempotent for an unchanged source fingerprint and must not silently overwrite operator-authored notes.

## Review Focus

- **Long/noisy transcripts:** memory generation remains bounded and deterministic, with chapters based on time/speaker/content boundaries rather than unbounded text concatenation; Task 4 tests this.
- **Services with little/no transcript:** memory still records rundown, Scripture, speakers/artifacts/incidents that exist and returns a truthful sparse summary; Task 4 tests this.
- **Cross-tenant history/search:** prior-service suggestions and Archive memory never cross organization boundaries; Tasks 2 and 5 test this.
- **Stale preparation context:** suggestions identify provenance and source service/time and never mutate the plan automatically; Tasks 2 and 3 test this.
- **Regeneration after source changes:** unchanged fingerprints are idempotent; changed ended-service source truth regenerates derived memory without deleting operator notes; Task 4 tests this.

---

### Task 1: Preparation Notes and Service Memory Contracts

**Files:**
- Create: `apps/control/db/042_service_intelligence_memory.sql`
- Create: `apps/control/src/lib/service-intelligence/contracts.ts`
- Create: `apps/control/src/lib/service-intelligence/notes.ts`
- Create: `apps/control/scripts/service-intelligence-schema-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `apps/control/scripts/db-selftest-safety-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Produces: `upsertServicePreparationNote(client,userId,input)`, `listServicePreparationNotes(client,userId,serviceId)`, `ServicePreparationNote`, `ServiceMemoryRecord`, `ServiceMemoryChapter`.
- Schema: `service_preparation_notes`, `service_memories`, `service_memory_chapters`; composite organization/service FKs and source fingerprint/indexes.

- [ ] Write failing real-PostgreSQL schema/service test for tenant scoping, Planner-mutation-role writes, member reads, 100k-character note bound, audit events, memory/chapter constraints and production-DB safety.
- [ ] Run `pnpm --dir apps/control test:service-intelligence-schema`; expect RED on missing migration/module.
- [ ] Implement migration `042` and note service; note writes never change service/rundown state.
- [ ] Verify schema test + Planner contract + DB safety + lint PASS.
- [ ] Commit as `feat(control): add service intelligence contracts`.

### Task 2: Preparation Context and Evidence-Backed Suggestions

**Files:**
- Create: `apps/control/src/lib/service-intelligence/preparation.ts`
- Create: `apps/control/scripts/service-preparation-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 1 notes, existing `loadPlannerServiceDetail()`, Media Library, prior ended services/memories, output/language/Edge truth, Scripture parser.
- Produces: `buildServicePreparationContext(client,userId,serviceId,options?) -> ServicePreparationContext` with `suggestions[]` containing `kind`, `title`, `reason`, `evidence`, `sourceServiceId`, `sourceObservedAt`, `confidence`, and typed `plannerCandidate | navigationTarget`.

- [ ] Write failing PostgreSQL test covering sermon-note Scripture references, previous same-type service reuse, reusable song/media evidence, configured outputs/languages/Edge readiness, deterministic ordering, stale provenance, sparse-history behavior and cross-tenant exclusion.
- [ ] Run `test:service-preparation`; expect RED.
- [ ] Implement bounded deterministic context/suggestion projection; do not mutate Planner or Program.
- [ ] Verify preparation + Media + Planner + Cockpit recommendation regressions PASS.
- [ ] Commit as `feat(control): add service preparation intelligence`.

### Task 3: Planner Preparation Workspace and Explicit Suggestion Adoption

**Files:**
- Create: `apps/control/src/components/planner/ServicePreparationPanel.tsx`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/preparation/route.ts`
- Create: `apps/control/src/app/api/v1/planner/services/[id]/preparation/apply/route.ts`
- Modify: `apps/control/src/app/planner/[id]/page.tsx`
- Create: `apps/control/scripts/service-preparation-ui-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 2 context; existing `createPlannerItem()` + planner revision contract.
- Produces: pre-service panel showing notes, readiness and evidence-backed suggestions; explicit `Add to plan` mutation only.

- [ ] Write failing UI/API contract test: no automatic plan mutation, current revision required, role/RBAC enforced, unsupported suggestion is navigation-only, note editing separate from suggestion application, ≥44px primary touch controls.
- [ ] Implement authenticated preparation GET/apply endpoints and Planner panel; apply delegates to `createPlannerItem()` in a transaction.
- [ ] Verify UI test + Planner item/readiness + Cockpit acceptance + build PASS.
- [ ] Commit as `feat(control): add intelligent service preparation workspace`.

### Task 4: Deterministic After-Service Memory Builder

**Files:**
- Create: `apps/control/src/lib/service-intelligence/memory.ts`
- Create: `apps/control/src/app/api/v1/services/[id]/memory/rebuild/route.ts`
- Modify: `apps/control/src/app/api/v1/services/[id]/state/route.ts`
- Create: `apps/control/scripts/service-memory-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `apps/control/scripts/db-selftest-safety-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Produces: `buildServiceMemory(client,userIdOrSystem,serviceId,options?) -> ServiceMemoryRecord`; `sourceFingerprint`; chapter list; summary; key Scriptures; speakers; songs/media; incidents; language/output/artifact metadata.
- End-service integration: after successful end transaction, best-effort bounded memory build; failure is audited and never rolls back `ended`.

- [ ] Write failing PostgreSQL test for chapter boundaries (speaker/time/content changes), noisy/long transcript bounds, no-transcript service, key Scripture/rundown extraction, output/stream incident evidence, idempotent unchanged rebuild, changed-source regeneration, tenant isolation and no Program mutations.
- [ ] Run `test:service-memory`; expect RED.
- [ ] Implement deterministic builder with stable source fingerprint and bounded text; do not call external providers.
- [ ] Integrate best-effort post-end build and explicit authorized rebuild endpoint.
- [ ] Verify memory + service lifecycle + stream lifecycle + transcript + DB safety PASS.
- [ ] Commit as `feat(control): remember ended services`.

### Task 5: Intelligent Archive Search and Reuse

**Files:**
- Modify: `apps/control/src/lib/archive.ts`
- Modify: `apps/control/src/app/archive/page.tsx`
- Modify: `apps/control/src/app/archive/[id]/page.tsx`
- Modify: `apps/control/src/components/archive/ArchiveList.tsx`
- Modify: `apps/control/src/components/archive/ArchiveServiceDetail.tsx`
- Create: `apps/control/src/app/api/v1/archive/[id]/reuse/route.ts`
- Create: `apps/control/scripts/service-memory-archive-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 4 memory + existing Archive truth.
- Produces: tenant-scoped search across service title, memory summary/chapter titles, Scripture refs and speaker evidence; memory detail; explicit `Reuse in service plan` action that delegates to Planner mutations for a chosen draft/ready target.

- [ ] Write failing test for search relevance, sparse memory fallback, tenant isolation, no private note leakage, memory metadata on detail, explicit target service/revision for reuse, and refusal to mutate live/ended target plans.
- [ ] Implement Archive memory joins/search and explicit reuse route through existing Planner service.
- [ ] Verify Archive + Planner + licensing/security + build PASS.
- [ ] Commit as `feat(control): add intelligent service archive`.

### Task 6: Service Intelligence Acceptance, UAT and CI Gate

**Files:**
- Create: `apps/control/scripts/service-intelligence-acceptance-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `apps/control/scripts/studio-route-manifest-selftest.mjs` only if a new emitted route requires it.
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: release gate proving the complete `Prepare -> Assist -> Preview -> Program -> Remember -> Prepare again` loop without changing Program authority.

- [ ] Write failing acceptance test covering: add sermon note -> get evidence-backed preparation -> explicit add to Planner -> operate through existing Cockpit -> end service -> memory generated -> Archive searchable -> reuse selected history into a future draft service.
- [ ] Assert no public Audience route exposes notes/memory-private fields, no service-end dependency on external provider, and no new direct Program mutation vocabulary in service-intelligence modules.
- [ ] Run complete service-intelligence tests + Planner/Archive/Cockpit/Audience/Streaming/licensing security + DB safety + lint + fresh production build + route manifest.
- [ ] Run representative UAT using a sermon note with Scripture references, multi-speaker transcript, songs, one stream incident and one translated channel.
- [ ] Commit as `ci(control): gate service intelligence memory loop` and require full GitHub Control CI before integration.

## Execution Boundaries

- Build on current green `main` after Cockpit + Switching Moat integration.
- Keep derived intelligence independently rebuildable; never make it the sole copy of transcript, Scripture, rundown, speaker, stream or artifact truth.
- Do not introduce an external AI-provider runtime dependency in this workstream. A later provider adapter may enrich summaries/suggestions only behind the deterministic contracts established here.
- Preserve the Experience Moat principle: intelligence should reduce operator preparation/search work, not create another analytics dashboard.
