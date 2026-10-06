# Desktop Operator Catalog & Scripture Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace seeded desktop content with a secure, device-scoped, offline-capable service/scripture catalog synced by the Edge runtime.

**Architecture:** The Control Plane exposes bounded Edge-authenticated operator catalog and scripture-reference endpoints. The Edge runtime is the only cloud-authenticated desktop component; it synchronizes a versioned atomic local cache and exposes catalog/scripture operations over existing same-user IPC. Avalonia reads that IPC and keeps Preview/Take/Clear unchanged.

**Tech Stack:** Next.js/TypeScript/PostgreSQL, .NET 10/C#, Avalonia 12, xUnit, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-desktop-catalog-design.md`

## Global Constraints
- The Avalonia desktop process must never receive or persist Edge bearer credentials, pairing codes, provider OAuth tokens or stream keys.
- Existing loopback renderer stays read-only.
- Catalog results are device/tenant/active-service scoped and bounded: Bible versions <= 32, service items <= 200, scripture queue <= 200, verse ranges <= 80.
- Existing local presentation body limit remains 12,000 characters.
- Service changes purge old service-scoped cache content before new content is accepted.
- Cloud failure preserves the last safe same-service cache and marks it stale.
- Windows/macOS, native media and SRT CI gates remain mandatory.

## Review Focus
- Device assigned to a service in another tenant/campus must receive no catalog content.
- Stale cache from a previous service must never appear after assignment changes.
- Malformed/corrupt/unknown-version cache must not block Edge startup.
- Scripture reference parsing must reject malformed/oversized ranges without leaking SQL or provider details.
- Desktop rehearsal samples must never replace a real but temporarily offline synced catalog.

---

### Task 1: Device-scoped Control Plane operator read model

**Files:**
- Create: `apps/control/src/lib/edge-operator-catalog.ts`
- Create: `apps/control/src/app/api/v1/edge/operator/catalog/route.ts`
- Create: `apps/control/src/app/api/v1/edge/operator/scripture/route.ts`
- Create: `apps/control/scripts/edge-operator-catalog-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Produces: `parseOperatorScriptureReference(input: string)` and route payloads consumed by `HttpOperatorCatalogClient` in Task 3.
- Route payload fields match the spec exactly: service, bibleVersions, items, catalogRevision, observedAt and presentation-safe scripture item.

- [ ] Write failing parser/normalizer self-tests for `John 3:16`, `Psalm 23`, verse range cap 80, malformed reference, deterministic item id, and safe body truncation.
- [ ] Run `npm run test:edge-operator-catalog` and verify RED because helper/script does not exist.
- [ ] Implement the pure helper with explicit bounded parsing and presentation normalization.
- [ ] Add catalog route using `authenticateEdgeDevice`; SQL must join active device/service organization and campus scope and cap every collection.
- [ ] Add scripture resolver route using the helper, active service Bible-version default, locally-enabled version check and passage resolution.
- [ ] Run the new self-test plus `npm run lint` and `npm run build`; all must pass.
- [ ] Commit `feat(control): add edge operator catalog read model`.

### Task 2: Versioned atomic Edge catalog cache

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/OperatorCatalogModels.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/OperatorCatalogStore.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/OperatorCatalogStoreTests.cs`

**Interfaces:**
- Produces: `OperatorCatalogSnapshot`, `OperatorCatalogService`, `OperatorBibleVersion`, `OperatorCatalogItem`, and `OperatorCatalogStore.ReadAsync/WriteAsync/ClearServiceAsync`.
- Task 3 consumes these exact types; Task 4 returns them over IPC.

- [ ] Write failing xUnit tests for round-trip, atomic replacement, corrupt JSON -> null, unsupported schema -> null, service-change purge, and no secret-like fields in serialized JSON.
- [ ] Run targeted tests and verify RED because the models/store do not exist.
- [ ] Implement schema version 1 models and atomic `.tmp` write/replace with bounded normalization.
- [ ] Run targeted tests GREEN, then full Core test project GREEN.
- [ ] Commit `feat(edge): add durable operator catalog cache`.

### Task 3: Authenticated runtime catalog synchronization

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IOperatorCatalogClient.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Transport/HttpOperatorCatalogClient.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/HttpOperatorCatalogClientTests.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/OperatorCatalogSyncTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/EdgeAgentRuntime.cs`
- Modify platform composition roots only as required to provide the Edge data directory/store.

**Interfaces:**
- Produces: `IOperatorCatalogClient.GetCatalogAsync()` and `ResolveScriptureAsync(reference, version)` plus runtime-maintained `OperatorCatalogStore`.
- Consumes Task 1 JSON payloads and Task 2 models/store.

- [ ] Write failing HTTP-client tests proving Authorization uses the credential store internally, DTOs expose no token, and invalid payloads fail closed.
- [ ] Write failing sync tests proving initial sync, heartbeat refresh, network failure preserves same-service cache, and assignment change clears previous service cache before refresh.
- [ ] Implement authenticated client and runtime sync with bounded error handling; do not expose credentials outside transport.
- [ ] Run targeted tests GREEN, then full Core tests GREEN.
- [ ] Commit `feat(edge): sync authenticated operator catalog`.

### Task 4: Catalog/scripture over same-user local IPC

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorContracts.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorCommandHandler.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/LocalOperatorClient.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCommandHandlerTests.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/LocalOperatorClientTests.cs`

**Interfaces:**
- Produces allowlisted `catalog.query` and `scripture.resolve` commands; response contains optional catalog/resolved presentation and stale indicator, never org/service/token injection fields.
- Task 5 consumes `LocalOperatorClient.QueryCatalogAsync` and `ResolveScriptureAsync`.

- [ ] Write failing command-handler tests for catalog query, stale status, exact offline resolution, unavailable-offline error, input length/version bounds, and no service-id injection.
- [ ] Write failing desktop IPC client tests for catalog query and scripture resolve over the real named-pipe/Unix-socket transport.
- [ ] Extend contracts/handler/client minimally and keep existing Preview/Take/Clear behavior unchanged.
- [ ] Run Core and Desktop targeted tests GREEN, then both full test projects GREEN.
- [ ] Commit `feat(edge): expose operator catalog over local ipc`.

### Task 5: Replace seeded desktop rundown with real cached catalog

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/OperatorWorkspaceCatalog.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Create or modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/OperatorWorkspaceCatalogTests.cs`
- Modify docs/README only where current desktop behavior is described.

**Interfaces:**
- Consumes Task 4 `QueryCatalogAsync`/`ResolveScriptureAsync`.
- Existing `preview.render`, `program.take`, `program.clear` remain the presentation mutation path.

- [ ] Write failing tests for real-catalog mapping/filtering, active Bible-version default, stale/offline badge model, rehearsal fallback only when no synced catalog exists, and resolved scripture -> workspace item.
- [ ] Implement desktop model mapping and UI controls: service/cache status, Bible selector, reference field/action, synced rundown; preserve three-pane layout and keyboard shortcuts.
- [ ] Add safe user-facing errors for invalid reference and unavailable-offline cases.
- [ ] Run Desktop tests GREEN and full Core tests GREEN.
- [ ] Run `dotnet build` for Windows and macOS platform projects where supported by CI, then push branch and require Edge Agent CI Windows + macOS jobs including SRT smoke/artifact upload.
- [ ] Commit `feat(desktop): use synced service and scripture catalog`.

### Task 6: Whole-slice verification and handoff

**Files:**
- No production files unless verification finds a defect.

**Interfaces:**
- Consumes all prior tasks and validates the spec end-to-end.

- [ ] Run `git diff --check` and confirm clean.
- [ ] Run Control Plane self-test/lint/build and both .NET test projects.
- [ ] Confirm serialized cache and IPC contracts contain no credential/token/pairing/stream-key fields.
- [ ] Confirm existing loopback renderer has no new mutation route.
- [ ] Push the branch, inspect both CI jobs to completion, and verify Windows/macOS artifacts exist.
- [ ] Review the whole branch against this plan/spec; fix Critical/Important findings test-first.
- [ ] Open/ready PR for Issue #42 only after all gates are green.
