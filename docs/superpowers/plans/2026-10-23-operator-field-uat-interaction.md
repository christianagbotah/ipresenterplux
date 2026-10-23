# Operator Field UAT Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Operator content selection, local Scripture, Bible browsing, local scheduling, Setup scrolling and heartbeat rendering behave correctly during physical field use.

**Architecture:** Keep existing Edge authority for Preview/Program while adding a desktop offline Bible library and a persisted local rehearsal schedule. Library, details and schedule all call the same Preview/TAKE commands. Periodic runtime/catalog refreshes update only when presentation/catalog identity changes instead of rebinding collections every second.

**Tech Stack:** .NET 10, Avalonia 12.1.3, System.IO.Compression, HttpClient, System.Text.Json, xUnit, existing GitHub Actions Windows/macOS CI.

**Spec:** `docs/superpowers/specs/2026-10-23-operator-field-uat-interaction-design.md`

## Global Constraints
- Preview remains safe; Program changes only through TAKE except separately armed server-authorized Auto Scripture Live.
- F6/F8/F7 behavior must remain unchanged.
- Bible packages must be HTTPS, public-domain/authorized, bounded and extracted without arbitrary ZIP traversal.
- Local schedule persistence must be bounded and atomic and must not mutate the cloud planner.
- No media download safety, recording scope, pairing-security or updater semantics change.
- Setup must remain usable at the existing 1040×640 restored target.

## Review Focus
- Double-click while first-click Preview is still in flight must still end on the intended item in Program.
- Periodic snapshot/catalog heartbeats must not continuously rebind Library, Schedule or Bible-version controls.
- Rebinding filtered/scheduled rows must not steal which surface is authoritative for F6/double-click.
- Malformed/oversized Bible ZIPs or corrupt schedule JSON must fail safely without losing previously valid data.
- Whole-chapter browsing must handle Psalms, numbered books, missing chapters and verse ranges predictably.

---

### Task 1: Pointer interaction and Setup field layout

**Files:**
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`

**Interfaces:**
- Produces pointer handlers that invoke existing Preview/TAKE paths.
- Produces two Setup `ScrollViewer`s and the requested two-column enrollment/output rows.

- [x] Pin single-click Preview, double-click Preview→TAKE, requested Setup row pairing and independent Setup scroll surfaces.
- [x] Observe RED against `0a87da2`.
- [x] Implement desktop wiring without changing output authority.

### Task 2: Safe offline Bible package library

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopBibleLibrary.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/DesktopBibleLibraryTests.cs`

**Interfaces:**
- Produces `BiblePackageDescriptor` catalog entries.
- Produces installed-version discovery, safe installation, reference/range resolution and book/chapter/verse browsing.

- [x] Pin parser/reference/range/package-safety behavior.
- [x] Implement bounded HTTPS ZIP download, safe VPL extraction, atomic replacement and local resolver.
- [x] Add book/chapter/verse APIs and tests for whole-chapter browsing.

### Task 3: Bible manager and local-first Scripture

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/BibleVersionManagerWindow.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`

**Interfaces:**
- Consumes `DesktopBibleLibrary`.
- Produces Bible Versions management and local-first rehearsal Scripture preview.

- [x] Expose Bible Versions action and merge local/synced version choices.
- [x] Resolve installed editions locally without requiring active service.
- [x] Retain existing synced-service resolver fallback for nonlocal editions.
- [x] Feed searched/selected Scripture into Selected Content and the whole-chapter browser.

### Task 4: Stop heartbeat-driven Operator flicker

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

**Interfaces:**
- Produces `OperatorPresentationChanged(previous,current)` and `RefreshOperatorFeedback(snapshot)`.

- [x] Pin that heartbeat rendering is identity-gated.
- [x] Remove unconditional rundown/Bible-version rebinding from one-second refresh.
- [x] Rebuild Library/Schedule only on meaningful presentation/catalog change.

### Task 5: Library, details and persisted local service schedule

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopOperatorScheduleStore.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/DesktopOperatorScheduleStoreTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

**Interfaces:**
- Produces separate Library, Selected Content and Service Schedule surfaces.
- Produces atomic `LoadAsync`/`SaveAsync` for at most 200 local schedule items.

- [x] Pin local schedule ordering, corrupt-file fail-safe behavior and screen structure.
- [x] Implement Add Selected, Remove, Move Up and Move Down.
- [x] Persist/restore the local schedule without writing the cloud planner.
- [x] Route Library/Schedule single click and double click through shared Preview/TAKE helpers.

### Task 6: AI Scripture discoverability

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`

**Interfaces:**
- Produces an Operator entry to the authenticated Control Plane `/scripture` automation workspace.

- [x] Explain Manual, Auto Preview and guarded Auto Live on desktop.
- [x] Keep organization permission, confidence thresholds and separate Auto Live arm action server-authoritative.

### Task 7: Organization-wide Songs/Slides/Media desktop library transport

**Files:**
- Follow-on: Control Plane Edge-authenticated library endpoint, Edge catalog/client contracts, desktop catalog integration and media descriptor handling.

**Interfaces:**
- Must expose presentation-safe organization library data to the authenticated Edge runtime without browser session cookies or raw source configuration.

- [ ] Reuse `media_library_items` and existing planner normalization rather than duplicating song/media parsing.
- [ ] Add Edge-authenticated bounded library search/sync.
- [ ] Preserve safe media descriptor validation before local Preview.
- [ ] Merge organization library results into desktop Library independently of the active service rundown.


### Task 7A: Persistent production workspace redesign

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

**Interfaces:**
- Produces fixed `Service Schedule | Preview | Program` production row.
- Produces bottom Resource Deck whose scroll/layout cannot displace production monitors.
- Produces pointer click-count handlers bound to the exact clicked row.

- [ ] Pin persistent stage geometry and resource-deck separation.
- [ ] Pin pointer click-count interaction and removal of competing Tapped/DoubleTapped handlers.
- [ ] Implement compact runtime status in header/production row and move deep runtime controls out of the live workspace.
- [ ] Verify restored 1040×640 viewport keeps Schedule, Preview and Program visible while Scripture details overflow internally.

### Task 8: Integration verification and field-UAT artifact

**Files:**
- Update focused QA notes as needed.

**Interfaces:**
- Produces a traceable Windows/macOS candidate from the exact branch head.

- [ ] Run source contracts and `git diff --check`.
- [ ] Commit/push branch and update draft PR #107 stacked on `fix/operator-layout-field-uat`.
- [ ] Require Windows desktop tests, launch smoke, Windows package gates and macOS desktop tests to pass.
- [ ] Produce exact installer artifact/checksum and provide a durable retrieval path for laptop/TV field testing.
