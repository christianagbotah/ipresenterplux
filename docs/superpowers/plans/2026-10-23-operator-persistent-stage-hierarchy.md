# Operator Persistent Stage Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Keep Preview/Program large and permanently visible while secondary operator content scrolls independently.

**Architecture:** Fix the center Grid's vertical allocation rather than hiding features. Live stages receive a protected 3* row; details receive a 2* scrolling row. 16:9 stage Viewboxes scale to 560x315 on wide displays while still shrinking proportionally on narrow displays.

**Tech Stack:** C# 13 / .NET 10 / Avalonia UI / xUnit

**Spec:** `docs/superpowers/specs/2026-10-23-operator-persistent-stage-hierarchy-design.md`

## Global Constraints
Preserve all current operator actions and runtime authority. Do not alter output, media, Scripture-resolution, service-schedule, licensing, recording or streaming behavior.

## Review Focus
- Details content must never collapse the stage row.
- 1040x640 restored mode must remain usable.
- 16:9 must remain exact at every size.
- Side panes must continue scrolling independently.
- Details/Bible browser overflow must stay inside its own region.

### Task 1: Protect and enlarge live stages

**Files:**
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowLayoutTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`

- [ ] Write failing layout source-contract tests for 3*:2* center rows, stage floor/ceiling, 560x315 Viewboxes, and scroll-contained details.
- [ ] Verify RED against the field build.
- [ ] Replace Auto details allocation with weighted rows and an internal details ScrollViewer.
- [ ] Increase Preview/Program maximum stage size without changing the 640x360 source frame.
- [ ] Verify source contracts, `git diff --check`, then run authoritative Windows/macOS CI after push.
