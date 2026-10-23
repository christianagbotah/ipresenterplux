# Operator Field UAT Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Operator content selection, local Scripture, Bible downloads, and Setup scrolling behave correctly during physical field use.

**Architecture:** Keep existing Edge authority for output while adding a desktop offline Bible library for rehearsal/offline Scripture. Rundown pointer gestures call the same Preview/TAKE paths already used by keyboard/buttons. Setup becomes two independently scrolling columns.

**Tech Stack:** .NET 8, Avalonia, System.IO.Compression, HttpClient, xUnit, existing GitHub Actions Windows/macOS CI.

**Spec:** `docs/superpowers/specs/2026-10-23-operator-field-uat-interaction-design.md`

## Global Constraints
- Preview remains safe; Program changes only through TAKE.
- F6/F8/F7 behavior must remain unchanged.
- Bible packages must be HTTPS, public-domain/authorized, bounded, and extracted without arbitrary ZIP traversal.
- No media, recording, pairing-security, or updater semantics change.
- Setup must remain usable at the existing 1040×640 restored target.

## Review Focus
- Double-click while first-click Preview is still in flight must still end on the intended item in Program.
- Periodic catalog refresh must not auto-preview rows just because selection is rebound.
- Malformed or oversized Bible ZIPs must fail without replacing a previously installed edition.
- Scripture aliases such as `Psalm 23`, `John 3:16`, `1 John 4:8`, and verse ranges must resolve predictably.
- Independent Setup scrolling must not reintroduce horizontal clipping.

---

### Task 1: Pin field interaction and Setup layout

**Files:**
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`

**Interfaces:**
- Produces user-pointer handlers that invoke existing Preview/TAKE methods.
- Produces two Setup `ScrollViewer`s and requested two-column field rows.

- [ ] Add failing source/behavior contracts for single-click Preview, double-click Preview→TAKE, Bible manager visibility, requested Setup row pairing, and independent Setup scroll surfaces.
- [ ] Verify tests/contracts fail against `0a87da2`.
- [ ] Implement the minimal desktop wiring.
- [ ] Verify focused desktop tests pass in CI.
- [ ] Commit.

### Task 2: Add safe offline Bible package library

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopBibleLibrary.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/DesktopBibleLibraryTests.cs`

**Interfaces:**
- Produces `BiblePackageDescriptor` catalog entries.
- Produces `ListInstalledAsync`, `InstallAsync`, and `ResolveAsync(reference, version, token)`.
- Stores one validated VPL text file plus metadata per edition under the desktop local-data root.

- [ ] Write parser tests for references, aliases, ranges and local passage resolution plus package safety validation.
- [ ] Verify RED in Windows/macOS CI.
- [ ] Implement bounded HTTPS ZIP download, safe VPL extraction, atomic replacement, metadata, installed-version discovery, and local resolver.
- [ ] Verify focused and full desktop suites.
- [ ] Commit.

### Task 3: Add Bible Versions manager and rehearsal lookup

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/BibleVersionManagerWindow.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

**Interfaces:**
- Consumes `DesktopBibleLibrary` from Task 2.
- Produces a visible `Bible Versions` action and installed/downloadable status.
- Local installed editions resolve directly to Preview even when no active service exists; nonlocal versions retain current Edge resolver fallback.

- [ ] Write failing contracts for manager action, installed-version merge, and local-first scripture resolution.
- [ ] Verify RED.
- [ ] Implement manager window and refresh selector after installation.
- [ ] Implement local-first `ResolveAndPreviewScriptureAsync` without weakening existing synced-service scope checks.
- [ ] Verify desktop suite and source contract.
- [ ] Commit.

### Task 4: Integration verification and UAT artifact

**Files:**
- Update: `docs/qa/edge-media-playback-field-uat.md` only if interaction checks belong there; otherwise add a focused Operator UAT note.

**Interfaces:**
- Produces a traceable Windows/macOS candidate from the exact branch head.

- [ ] Run `git diff --check` and inspect branch scope.
- [ ] Push branch and open/update a draft PR stacked on `fix/operator-layout-field-uat`.
- [ ] Require Windows desktop tests, launch smoke, Windows package gates, and macOS desktop tests to pass.
- [ ] Download the exact Windows installer artifact, verify SHA-256, and provide it for the next laptop/TV field check.
