# Operator Layout Field-UAT Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair the field-observed Operator layout so controls never overlap and the three-column screen uses available space more efficiently.

**Architecture:** Make targeted Avalonia layout changes only in `MainWindow.cs`, pinned by `MainWindowLayoutTests.cs`. No runtime command or media behavior changes.

**Tech Stack:** C# / Avalonia / xUnit

**Spec:** `docs/superpowers/specs/2026-10-23-operator-layout-field-uat-design.md`

## Global Constraints
- Preserve 16:9 Preview/Program.
- Preserve Edge-authoritative transitions and hotkeys.
- No change to pairing, media, licensing, recording, streaming, or update semantics.

## Review Focus
- 1366x768-class scaled laptop viewport must not overlap Scripture controls.
- Preview and Program must remain equal-sized 16:9 surfaces.
- Safety hint must be below, not between, transition buttons.
- Side panes must retain internal scrolling without outer horizontal scrolling.
- Dynamic media controls must still share the action row without forcing the safety hint into it.

### Task 1: Pin compact Operator layout contract
**Files:**
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`

- [ ] Write source-contract assertions for 6px outer margin, 4px inter-column/stage gaps, 240/250 side rails, 340x191 maximum 16:9 stage viewboxes, explicit two-row Scripture lookup grid, and a dedicated transition-hint row.
- [ ] Verify the new assertions fail against the current layout.
- [ ] Implement the minimal Avalonia layout changes.
- [ ] Verify source contract passes; rely on Windows CI for authoritative .NET/Avalonia execution because dotnet is unavailable on the VPS.
- [ ] Commit the focused repair.
