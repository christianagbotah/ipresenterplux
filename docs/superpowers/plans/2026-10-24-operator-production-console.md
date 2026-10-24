# Operator Production Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Operator dashboard geometry with an adjustable professional production console.

**Architecture:** Keep the existing Avalonia desktop shell and operator command model. Recompose only `BuildOperatorContent`, `BuildProductionPane`, and `BuildStage` around nested `Grid` + `GridSplitter` controls so Schedule/Preview/Program widths and production/resource heights resize at runtime while the 16:9 render surfaces scale to available space.

**Tech Stack:** .NET 10, C#, Avalonia `Grid`, `GridSplitter`, existing xUnit source-contract tests.

**Spec:** `docs/superpowers/specs/2026-10-24-operator-production-console-design.md`

## Global Constraints
- Preserve single-click Preview and double-click Program behavior.
- Preserve F6 Preview, F8 Take, F7 Clear.
- Preserve Edge as physical Preview/Program authority.
- Add no third-party docking dependency.
- Keep PR #109 draft and stable channel untouched.

## Review Focus
- Very narrow windows must constrain splitters instead of making panes disappear completely.
- 16:9 stages must scale up and down without distortion.
- Dragging vertical splitters must not affect Resource Deck height.
- Dragging horizontal splitter must not alter production-column proportions.
- Existing media controls and program buttons must remain reachable.

---

### Task 1: Lock the adjustable workspace contract

**Files:**
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

- [ ] Add failing assertions for two vertical `GridSplitter`s and one horizontal `GridSplitter`.
- [ ] Assert the fixed `MaxWidth = 400` production cap and `MaxWidth = 320` stage cap are gone.
- [ ] Assert stage Viewbox stretches in both axes and keeps `Stretch.Uniform`.
- [ ] Assert production/resource rows are star-sized around a splitter.
- [ ] Run the source-contract checker / desktop tests and confirm RED.

### Task 2: Build resizable production panes

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

- [ ] Rebuild upper production grid as Schedule / splitter / Preview / splitter / Program.
- [ ] Set minimum widths on Schedule, Preview, and Program so drag cannot collapse a pane into unusability.
- [ ] Flatten production pane chrome and remove centered fixed-width card behavior.
- [ ] Make stage Viewboxes stretch with available pane space while preserving 16:9.
- [ ] Verify layout contract GREEN.

### Task 3: Make Resource Deck height adjustable

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`

- [ ] Change Operator root to production star row / horizontal splitter / Resource Deck star row.
- [ ] Keep header fixed above the resizable workspace.
- [ ] Keep category tabs, Add Selected, AI Scripture, search, and Scripture lookup fixed inside Resource Deck.
- [ ] Verify the Resource Deck result list receives remaining height.

### Task 4: Verification and beta release

**Files:**
- Modify documentation only if verification reveals a correction.

- [ ] Run local source contract checks and inspect diff.
- [ ] Commit and push exact head.
- [ ] Require Windows Desktop Launch Smoke and full Edge Agent Windows/macOS CI green.
- [ ] Publish a new immutable beta build only after full Windows packaging succeeds.
- [ ] Verify beta update selection resolves to the new version while stable remains unchanged.
- [ ] Keep PR #109 draft for physical church UAT.