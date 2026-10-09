# Switching Moat Import and Interoperability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let churches adopt iPresenterPlux without recreating portable songs, media and service data by hand, while providing a safe coexistence bridge with existing production software during migration.

**Architecture:** Add a staged import layer that parses only documented portable formats into neutral import candidates, previews validation/results before commit, and delegates final creation to existing Media Library/Planner services. Keep imports tenant-scoped, auditable and reversible at batch level. Expose existing outbound/coexistence capabilities as a migration bridge instead of inventing proprietary compatibility or reverse-engineering competitor formats.

**Tech Stack:** Next.js 16.3.8, React 19, TypeScript 5, PostgreSQL 17, `pg`, existing Media Library/Planner/stream/output services, Node 22 self-tests.

**Spec:** `docs/superpowers/specs/2026-10-08-intelligent-service-cockpit-design.md`

## Global Constraints

- No reverse-engineering or dependency on proprietary competitor formats.
- Import only portable/documented data that can be validated before mutation.
- Preview/dry-run is mandatory before commit for multi-item imports.
- Final writes delegate to existing tenant/RBAC-aware Media Library/Planner services rather than bypassing them.
- Imported content retains source provenance and batch audit evidence.
- Undo removes only entities created by that import batch and must refuse deletion when later user edits/dependencies make automatic rollback unsafe.
- Media imports must not claim browser previewability unless existing Media Library source rules say they are eligible.
- Existing NDI/WebRTC/RTMP/output bridges remain authoritative; this plan does not create a new broadcast protocol.

## Review Focus

- **Duplicate content:** repeated import of the same file/batch must not silently multiply assets; Task 1/2 pin deterministic source fingerprints and explicit duplicate choices.
- **Malformed/huge input:** parser limits and per-row validation must fail safely without partial writes; Task 1 pins size/count limits.
- **Cross-tenant references:** media/source/rundown IDs from another organization must never be accepted; Task 2 pins tenant isolation.
- **Undo after later edits:** rollback must refuse destructive deletion when imported entities were edited/used later; Task 2 pins safe refusal.
- **Unsupported competitor exports:** UI must explain unsupported/proprietary formats and offer documented portable alternatives rather than pretending compatibility; Task 3 pins the empty/error copy.

---

### Task 1: Portable Import Batch and Parser Contracts

**Files:**
- Create: `apps/control/db/041_portable_import_batches.sql`
- Create: `apps/control/src/lib/imports/contracts.ts`
- Create: `apps/control/src/lib/imports/parsers.ts`
- Create: `apps/control/scripts/portable-import-parser-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `apps/control/scripts/db-selftest-safety-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Produces: `parsePortableImport(input) -> PortableImportPreview`; supported initial kinds: `song_text`, `song_csv`, `service_rundown_json`, `media_url_manifest`.
- Persists batch metadata/provenance only after user commits an import; parser/dry-run itself is non-mutating.

- [ ] Write failing parser/migration tests covering normalized song title/sections, CSV rows, service rundown items, HTTPS media URLs, source fingerprints, file/row limits, malformed input, duplicate fingerprints and unsupported/proprietary extensions.
- [ ] Run `pnpm --dir apps/control test:portable-import-parser`; expect RED on missing parser/migration.
- [ ] Implement migration `041`, exact typed parser contracts and strict limits; do not create library/Planner records yet.
- [ ] Verify parser test + DB safety PASS.
- [ ] Commit as `feat(control): add portable import contracts`.

### Task 2: Transactional Preview, Commit and Safe Undo

**Files:**
- Create: `apps/control/src/lib/imports/import-service.ts`
- Create: `apps/control/src/app/api/v1/imports/preview/route.ts`
- Create: `apps/control/src/app/api/v1/imports/commit/route.ts`
- Create: `apps/control/src/app/api/v1/imports/[id]/undo/route.ts`
- Create: `apps/control/scripts/portable-import-service-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 1 preview candidates, `createMediaLibraryItem()`, existing Planner mutation services.
- Produces: `previewPortableImport()`, `commitPortableImport()`, `undoPortableImport()` with batch audit/provenance.

- [ ] Write failing PostgreSQL service test: dry-run writes nothing; commit is atomic; same fingerprint requires explicit `skip | import_copy`; cross-tenant IDs fail; imported items preserve provenance; undo removes only untouched batch-created entities; later-edited/used items make undo return a safe conflict instead of deleting them.
- [ ] Run `pnpm --dir apps/control test:portable-import-service`; expect RED.
- [ ] Implement transactional service delegating final item creation to existing Media Library/Planner APIs; never insert presentation/library rows directly when a domain service exists.
- [ ] Verify service test + Media/Planner regressions + DB safety PASS.
- [ ] Commit as `feat(control): add transactional portable imports`.

### Task 3: Migration Wizard and Exportable Portable Formats

**Files:**
- Create: `apps/control/src/app/media/import/page.tsx`
- Create: `apps/control/src/components/imports/ImportWizard.tsx`
- Create: `apps/control/src/app/api/v1/exports/library/route.ts`
- Create: `apps/control/src/app/api/v1/exports/services/[id]/route.ts`
- Modify: `apps/control/src/components/media/MediaWorkspace.tsx`
- Create: `apps/control/scripts/import-wizard-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: Task 2 preview/commit/undo APIs.
- Produces: visible `Import existing content` entry from Library; dry-run table with valid/warning/error/duplicate rows; portable JSON/CSV export endpoints for church-owned data.

- [ ] Write failing UI/API contract test for upload/paste input, format selection, preview-before-commit, duplicate choices, batch summary, undo availability, and explicit unsupported/proprietary-format guidance.
- [ ] Implement wizard with no mutation until preview is accepted; show exactly what will be created/skipped/rejected.
- [ ] Add exports containing church-owned portable fields only; never export secrets/provider tokens/device credentials.
- [ ] Verify import wizard + Media workspace + licensing release-security + production build PASS.
- [ ] Commit as `feat(control): add migration import wizard`.

### Task 4: Coexistence Bridge and Switching Acceptance

**Files:**
- Create: `apps/control/src/components/imports/CoexistenceBridge.tsx`
- Modify: `apps/control/src/app/media/import/page.tsx`
- Create: `apps/control/scripts/switching-moat-acceptance-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: existing configured output destinations/media transports and import/export capabilities; introduces no new protocol.
- Produces: migration guidance/status showing which existing supported bridges can coexist with old production software during phased adoption.

- [ ] Write failing acceptance test that proves the UI distinguishes `import`, `coexist`, and `replace later`; lists only currently supported bridge types from authoritative configuration; never claims native compatibility with EasyWorship/ProPresenter/vMix/OBS proprietary projects; and keeps Preview/Program authority unchanged.
- [ ] Implement coexistence guidance and supported bridge summary using existing output/transport truth.
- [ ] Run `test:switching-moat-acceptance`, import tests, streaming/Audience regressions, lint, build and route-manifest validation.
- [ ] Require full GitHub Control CI before integration and run a migration UAT with a representative song set, media manifest and service rundown.
- [ ] Commit as `ci(control): gate switching migration bridge`.

## Execution Boundaries

- Execute only after the Cockpit runtime plan has a green foundation or on an independent stacked branch whose base is fixed and documented.
- Do not make importer availability a blocker for live Cockpit operation.
- Keep proprietary-format research outside this implementation unless an official/documented export format is available and separately approved.
- Measure field success by time-to-first-successful-service, imported/reused content percentage and operator actions avoided—not by cosmetic feature parity.
