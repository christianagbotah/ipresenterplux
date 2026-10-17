# Competitive UX Phase 4 — Live Assist Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing role-projected mobile Cockpit into a fast Live Assist surface with persistent Program/Preview/Next awareness and safe access to Scripture, Service, Media & Sources, Audience, and automation controls.

**Architecture:** Keep the existing Cockpit route and role projection; do not create a second remote-control product. Split the current `CockpitMobile` into focused mobile components, add a persistent live-state strip and bottom navigation, and reuse Universal Find/Command plus the same live mutation APIs/RBAC used on desktop.

**Tech Stack:** React 19.2.8, Next.js 16.3.8, TypeScript, responsive Tailwind, existing PWA/public assets, Cockpit APIs.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md`

## Global Constraints

- Minimum important touch target 44px; no hover-only primary action.
- Mobile never becomes a compressed Engineering dashboard.
- Role projection remains authoritative; hidden capabilities are not merely CSS-hidden.
- Persistent terms are Program, Preview, Next, TAKE, Clear/Black.
- Auto Scripture Live armed/disarm state is visible to authorized operators.
- Network loss must preserve current displayed live state and show reconnecting guidance rather than blanking controls.

## Review Focus

- Phone rotation and narrow widths must not hide Program/Preview state.
- Reconnect after temporary loss must not replay a stale mutation automatically.
- A pastor/service-leader role must not inherit producer Program controls.
- The bottom navigation must respect entitlements/roles rather than showing dead tabs.
- Armed Auto Scripture Live must remain obvious even when the operator is on another mobile tab.

---

### Task 1: Split mobile Cockpit into focused components

**Files:**
- Modify: `apps/control/src/components/cockpit/CockpitMobile.tsx`
- Create: `apps/control/src/components/cockpit/mobile/MobileLiveStrip.tsx`
- Create: `apps/control/src/components/cockpit/mobile/MobileBottomNav.tsx`
- Create: `apps/control/src/components/cockpit/mobile/MobileQuickActions.tsx`
- Create: `apps/control/scripts/live-assist-mobile-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- `MobileLiveStrip({ model, projection })` renders compact Program, Preview, Next and Auto Scripture Live state.
- `MobileBottomNav({ projection, active })` supports visible destinations `live`, `scripture`, `service`, `media_sources`, `audience` only when role permits.
- Components consume existing `CockpitViewModel`/`CockpitRoleProjection`; no duplicate state model.

- [ ] **Step 1: Write failing structural tests for 44px targets, persistent Program/Preview/Next, role-gated tabs, armed automation indicator, and no engineering counters.**
- [ ] **Step 2: Implement component split while preserving existing producer/pastor/interpreter/media-lead behavior.**
- [ ] **Step 3: Run mobile, role-projection, Cockpit acceptance tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): establish mobile Live Assist shell"`.

---

### Task 2: Integrate Universal Find on mobile

**Files:**
- Create: `apps/control/src/components/cockpit/mobile/MobileFindBar.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitMobile.tsx`
- Modify: `apps/control/scripts/live-assist-mobile-selftest.mjs`

**Interfaces:**
- Reuses Phase 2 `/api/v1/cockpit/search` and `/api/v1/cockpit/command`.
- Single-line entry label `What do you need next?` with 44px trigger/input.
- Results use same group IDs/order as desktop.

- [ ] **Step 1: Add failing tests for tap/keyboard submit, grouped results, Escape/back close, network error preservation, and no mutation while typing.**
- [ ] **Step 2: Implement compact mobile search sheet using existing APIs.**
- [ ] **Step 3: Run command/search/mobile tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): add mobile universal find"`.

---

### Task 3: Add safe live quick actions

**Files:**
- Modify: `apps/control/src/components/cockpit/mobile/MobileQuickActions.tsx`
- Modify: `apps/control/src/components/cockpit/ProgramPreviewStage.tsx`
- Modify: `apps/control/scripts/live-assist-mobile-selftest.mjs`

**Interfaces:**
- Producer may use existing TAKE/Clear controls with identical authorization and keyboard/pointer semantics.
- Visual source action remains Preview-only and links/requests through Phase 1 APIs.
- Auto Scripture Live exposes immediate Disarm when armed; enabling/arming remains in Scripture controls.

- [ ] **Step 1: Add failing tests for role-gated TAKE/Clear, no source-card live bypass, and one-tap Auto Scripture Live disarm.**
- [ ] **Step 2: Implement quick actions by composing existing components/APIs rather than duplicating mutations.**
- [ ] **Step 3: Run RBAC, keyboard-safety, mobile and Scripture automation UI tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): add safe Live Assist actions"`.

---

### Task 4: Mobile resilience and field UAT

**Files:**
- Modify: `apps/control/src/components/cockpit/CockpitMobile.tsx`
- Modify: `apps/control/src/components/audience/AudienceRealtimeRefresh.tsx` only if shared reconnect primitive is extracted
- Create: `apps/control/src/lib/realtime-reconnect.ts` only if both surfaces can share it cleanly
- Modify: `apps/control/scripts/live-assist-mobile-selftest.mjs`

**Interfaces:**
- On transient fetch/realtime loss, retain last known model, mark it stale/reconnecting, and never replay a mutation automatically.

- [ ] **Step 1: Add failing reconnect/stale-model tests.**
- [ ] **Step 2: Implement bounded reconnect with stale-state copy and no mutation replay.**
- [ ] **Step 3: Run PWA public-assets, Cockpit mobile, audience live-state, lint/build tests.**
- [ ] **Step 4: Field-UAT on Android + iOS Safari/PWA widths: one-handed navigation, TAKE/Clear authorization, Scripture search, Visual Source Preview, Auto Scripture Live disarm, rotation/reconnect.**
- [ ] **Step 5: Commit:** `git commit -m "fix(control): harden Live Assist mobile resilience"`.
