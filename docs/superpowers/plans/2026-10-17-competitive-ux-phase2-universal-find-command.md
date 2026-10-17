# Competitive UX Phase 2 — Universal Find & Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Cockpit command palette into one fast, keyboard/touch-friendly place to find Scripture, Songs, Media, current-service items, Visual Sources, and safe Actions.

**Architecture:** Keep deterministic command execution in `cockpit/commands.ts`, and add a separate read-only grouped search service so typing never causes a mutation. The palette queries grouped results while the user types; explicit command submission resolves through the existing command endpoint and all consequential live actions continue to use their normal RBAC/safety path.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript, PostgreSQL, existing Bible/Media/Planner/Visual Source services.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md`

## Global Constraints

- Search is read-only; typing or highlighting a result never mutates Preview or Program.
- The command parser remains deterministic before any future natural-language provider is added.
- Tenant, entitlement, and role projection are derived server-side from the authenticated user.
- Direct Scripture reference resolution remains local/offline-capable.
- Results group names are exactly: Scripture, Songs, Media, Service, Visual Sources, Actions.
- Consequential commands still require the explicit live controls/policies defined by their owning subsystem.

## Review Focus

- A query that resembles both a Scripture and a media title returns stable groups rather than choosing silently.
- Empty/whitespace/very long queries do not cause broad unbounded database scans.
- Users without Visual Sources/Media capability do not receive those groups.
- Search result activation with keyboard and touch invokes the same action as pointer activation.
- Network/search failure leaves the current Cockpit usable and does not close Program controls.

---

### Task 1: Add grouped read-only search service

**Files:**
- Create: `apps/control/src/lib/cockpit/search.ts`
- Create: `apps/control/scripts/cockpit-universal-search-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- `export type UniversalSearchGroupId = "scripture" | "songs" | "media" | "service" | "visual_sources" | "actions"`.
- `export type UniversalSearchItem = { id: string; group: UniversalSearchGroupId; title: string; subtitle: string | null; href: string | null; commandText: string | null }`.
- `export async function searchCockpit(client: PoolClient, actorUserId: string, input: { query: string; limitPerGroup?: number }): Promise<{ query: string; groups: Array<{ id: UniversalSearchGroupId; label: string; items: UniversalSearchItem[] }> }>`.
- Reuse `resolveLocalScripture`, `listMediaLibrary` (`song` split from other media), active service/planner data, and `listVisualSources` after Phase 1.
- Clamp query to 120 characters and `limitPerGroup` to 1–8, default 5.

- [ ] **Step 1: Write failing service tests for direct Scripture, song/media split, active-service item, visual source, capability filtering, zero-result groups, and bounded query/limit.**
- [ ] **Step 2: Run `test:cockpit-universal-search`; expect FAIL.**
- [ ] **Step 3: Implement `searchCockpit(...)` using existing domain services/queries; do not add mutation code.**
- [ ] **Step 4: Run search and existing command tests; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(control): add grouped Cockpit search"`.

---

### Task 2: Expose authenticated search API

**Files:**
- Create: `apps/control/src/app/api/v1/cockpit/search/route.ts`
- Modify: `apps/control/scripts/cockpit-universal-search-selftest.mjs`

**Interfaces:**
- `GET /api/v1/cockpit/search?q=<query>&limit=<1..8>`.
- Authentication and forced-password-change behavior matches `/api/v1/cockpit/command`.
- Response: `{ ok: true, search: Awaited<ReturnType<typeof searchCockpit>> }`.

- [ ] **Step 1: Add failing API tests for unauthenticated 401, invalid/blank query 400, tenant isolation, capability filtering, and no DB writes.**
- [ ] **Step 2: Implement route with Zod query validation.**
- [ ] **Step 3: Run search API tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): expose universal search API"`.

---

### Task 3: Expand deterministic commands without creating a live bypass

**Files:**
- Modify: `apps/control/src/lib/cockpit/commands.ts`
- Modify: `apps/control/scripts/cockpit-command-selftest.mjs`

**Interfaces:**
- Add navigation aliases for `visual sources`, `screens`, `windows`, and `themes` when those capabilities/routes exist.
- Add safe preparation command `preview <scripture>` using existing `scripture.preview` intent.
- Add safe source command intent `visual.preview` only after Phase 1; it issues `visual.preview.select`, never `program.take`/`program.show`.
- `take`, `go live`, `clear program`, and equivalent phrases remain rejected by the generic command layer unless explicitly delegated to a separately armed policy such as Auto Scripture Live.

- [ ] **Step 1: Add failing parser/executor tests for aliases, visual Preview, ambiguous source names, and live-mutation rejection.**
- [ ] **Step 2: Implement only the registered deterministic intents.**
- [ ] **Step 3: Run `test:cockpit-command` + visual command RBAC tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): expand safe Cockpit commands"`.

---

### Task 4: Make the palette the obvious “What do you need next?” surface

**Files:**
- Modify: `apps/control/src/components/cockpit/CommandPalette.tsx`
- Modify: `apps/control/src/components/cockpit/CockpitHeader.tsx`
- Modify: `apps/control/src/components/cockpit/FocusMode.tsx`
- Create: `apps/control/scripts/cockpit-command-surface-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Placeholder/label: `What do you need next?`.
- Desktop shortcut remains keyboard-first; mobile target is at least 44px.
- Debounce read-only search by 120ms; command submission remains explicit Enter/button action.
- Render groups in spec order with empty groups omitted.

- [ ] **Step 1: Write failing UI tests for label, group order, keyboard navigation, Escape, touch target floor, loading/error preservation, and no mutation on result highlight.**
- [ ] **Step 2: Implement grouped async search while preserving existing command submission.**
- [ ] **Step 3: Run `test:cockpit-command-surface`, `test:cockpit-focus`, `test:cockpit-keyboard-safety`, and `test:cockpit-acceptance`; expect PASS.**
- [ ] **Step 4: Run lint/build and commit:** `git commit -m "feat(control): make universal find the Cockpit entry point"`.
