# Cockpit Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live Cockpit stage persistent, landscape and readable while fixing Create Service viewport clipping and shared pointer affordance.

**Architecture:** Preserve the existing Cockpit composition and mutation safety, changing only responsive presentation classes and shared CSS. Protect the UX contract with a source-structure self-test wired into Control Portal CI.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, Node self-tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-10-cockpit-ergonomics-design.md`

## Global Constraints

- Preserve Preview → TAKE → Program semantics and server-gated authority.
- Preserve mobile stacking and existing keyboard safety.
- Do not globally enlarge the root font-size; raise only touched operational microcopy.
- Use hover pointer affordance only on hover-capable pointer devices; disabled controls remain `not-allowed`.
- Keep Preview and Program `aspect-video` with no competing minimum-height classes.

## Review Focus

- Short viewport: Create Service title input remains reachable without browser zoom or scrolling the page behind the dialog.
- Laptop viewport: sticky stage does not sit underneath the 68px sticky header.
- Narrow desktop: stage remains usable without forcing side-rail independent scrolling too early.
- Long Now/Next content: rail scrolling does not move Program out of view at `xl`.
- Disabled live controls: pointer affordance does not incorrectly suggest they are actionable.

---

### Task 1: Ergonomics contract

**Files:**
- Create: `apps/control/scripts/cockpit-ergonomics-selftest.mjs`
- Modify: `apps/control/package.json`
- Modify: `.github/workflows/control-ci.yml`

**Interfaces:**
- Consumes: source-class contracts in Cockpit, global CSS and Create Service dialog.
- Produces: `pnpm test:cockpit-ergonomics` CI gate.

- [ ] Write the structural self-test for 16:9/no forced stage min-height, sticky stage, bounded rails, modal top clearance/internal scrolling, pointer/disabled cursor rules and touched typography floor.
- [ ] Run the test against current source and verify it fails for the missing ergonomics contract.
- [ ] Wire `test:cockpit-ergonomics` into package scripts and Control Portal CI.

### Task 2: Stage and rails

**Files:**
- Modify: `apps/control/src/components/cockpit/ProgramPreviewStage.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitDepthControls.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitHeader.tsx`

**Interfaces:**
- Consumes: existing Cockpit view model and live-control callbacks unchanged.
- Produces: true 16:9 stages, sticky live center and independently scrolling xl rails.

- [ ] Remove competing stage minimum heights and retain width-driven 16:9 geometry.
- [ ] Make the center stage sticky below the header and bound side rails with independent scrolling at `xl`.
- [ ] Raise touched 10–11px Cockpit operational labels to `text-xs` without changing authorization or mutation code.
- [ ] Run the ergonomics self-test and existing Cockpit shell/acceptance tests.

### Task 3: Modal, pointer and verification

**Files:**
- Modify: `apps/control/src/components/planner/CreateServiceDialog.tsx`
- Modify: `apps/control/src/app/globals.css`

**Interfaces:**
- Consumes: existing Create Service form state/API unchanged.
- Produces: top-safe scrollable modal and shared interaction cursor baseline.

- [ ] Top-align the desktop modal with safe viewport padding and bound the panel height while preserving mobile bottom-sheet behavior.
- [ ] Raise touched modal 11px labels to `text-xs`.
- [ ] Add enabled pointer and disabled not-allowed global cursor rules.
- [ ] Run ergonomics, planner UI, focus consistency, lint and production build.
- [ ] Review the whole branch, merge only with green Control Portal CI, then verify production health/deployment.
