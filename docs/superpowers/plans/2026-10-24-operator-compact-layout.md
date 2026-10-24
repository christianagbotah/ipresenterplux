# Operator Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a compact Windows Operator layout with fixed resource controls and top-row About/update menu while preserving direct Preview/Program interaction.

**Architecture:** Keep the current Avalonia desktop shell and operator runtime. Change only `MainWindow.cs`, `DesktopUpdateHost.cs`, and their source-contract tests; no server/provider behavior changes.

**Tech Stack:** .NET, Avalonia, xUnit.

**Spec:** `docs/superpowers/specs/2026-10-24-operator-compact-layout-design.md`

## Global Constraints
- Single click previews; double click sends to Program.
- Edge remains Program authority.
- No provider secrets or Control changes.
- Updates remain safe-restart gated.

## Review Focus
- Compact layout must still fit 1040x640 restore bounds.
- Resource tabs/actions must not live in a scroll viewer.
- About/update menu must not add a bottom footer.
- Selected Content UI must be absent while Add Selected remains usable.
- Existing hotkeys and click-count semantics must remain intact.

### Task 1: Pin compact Operator layout contract
**Files:** modify `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`
- [ ] Add failing assertions for compact header, weighted schedule column, no selected-content panel, fixed category/add actions, and no resource-deck outer scroll.
- [ ] Run focused layout tests and confirm RED.

### Task 2: Implement compact Operator workspace
**Files:** modify `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- [ ] Implement one-row header, compact production row/stages, wider schedule pane, and simplified Resource Deck.
- [ ] Preserve pointer click behavior and Add Selected schedule action.
- [ ] Run layout tests and confirm GREEN.

### Task 3: Move updater into About menu
**Files:** modify `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/DesktopUpdateHostTests.cs`, `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/Update/DesktopUpdateHost.cs`
- [ ] Add failing contract test proving no bottom update bar and a top About menu with Check for updates.
- [ ] Implement menu overlay while preserving update coordinator and safe install logic.
- [ ] Run desktop tests and confirm GREEN.

### Task 4: Full verification and beta packaging
- [ ] Run desktop test suite, Edge test suite/build, diff check, and Windows launch/package smoke available on the VPS.
- [ ] Commit and push feature branch; keep PR #109 draft.
- [ ] If native source changed and verification is green, cut beta 1.0.497 and publish to beta only; do not promote stable.
