# Competitive UX Phase 5 — Theme Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rich presentation styling out of live-operation clutter into reusable church-owned themes that render consistently through the native Edge output pipeline.

**Architecture:** Add tenant-scoped theme records with a strict versioned appearance schema and service-level active-theme selection. The Control Portal edits/validates themes; the Edge presentation content API sends a sanitized optional appearance object; shared Edge Core renderers consume the same appearance contract for Preview/Program without changing live authority.

**Tech Stack:** Next.js/TypeScript/PostgreSQL/Zod Control Plane; .NET 10 Edge Core; SkiaSharp renderer; local Web Program output.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md`

## Global Constraints

- Theme editing is not shown in Essential live operation beyond active-theme name/select shortcut.
- Theme data is tenant-scoped and contains no arbitrary executable CSS/HTML/JavaScript.
- Unknown/invalid theme properties fall back safely to the built-in default.
- Preview and Program use the same resolved theme contract.
- Styling changes never bypass Preview/Program authority.
- Default templates: Sunday Modern, Lower Third Scripture, Sermon Scripture, Worship Lyrics, Announcement, Youth Service, Conference, Funeral, Wedding.

## Review Focus

- Malformed theme JSON must never crash Edge rendering.
- Deleting an active theme must fall back safely without breaking service output.
- Extreme font sizes/safe-area values must be clamped by schema, not trusted from UI.
- A tenant cannot fetch/apply another tenant's theme id.
- Older Edge agents that do not understand appearance must continue rendering title/body/footer.

---

### Task 1: Add theme storage and strict schema

**Files:**
- Create: `apps/control/db/044_presentation_themes.sql`
- Create: `apps/control/src/lib/presentation-themes.ts`
- Create: `apps/control/scripts/presentation-theme-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Table `presentation_themes(id, organization_id, name, template_key, appearance jsonb, is_builtin, created_by, created_at, updated_at)` with unique `(organization_id,name)`.
- Add nullable `services.active_theme_id` FK using `ON DELETE SET NULL`.
- `export const presentationAppearanceSchema` version `1` with bounded fields: background kind/value, primary/secondary text colors, font family from allowlist, title/body/footer size scales, horizontal/vertical alignment, shadow boolean, backing opacity 0..1, safe-area percent 0..15, animation enum `instant|fade|slide|zoom`, lower-third mode/position, logo media id/position/size.
- `export type PresentationAppearance = z.infer<typeof presentationAppearanceSchema>`.

- [ ] **Step 1: Write failing schema/service tests for tenant ownership, bounds, unknown keys, delete-active fallback, and built-in seeds.**
- [ ] **Step 2: Add additive migration and schema parser/resolver.**
- [ ] **Step 3: Run migration + theme tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): add reusable presentation themes"`.

---

### Task 2: Add Theme Studio APIs and service selection

**Files:**
- Create: `apps/control/src/app/api/v1/themes/route.ts`
- Create: `apps/control/src/app/api/v1/themes/[id]/route.ts`
- Create: `apps/control/src/app/api/v1/services/[id]/theme/route.ts`
- Modify: `apps/control/src/lib/role-policy.js`
- Modify: `apps/control/src/lib/rbac.ts`
- Modify: `apps/control/scripts/presentation-theme-selftest.mjs`

**Interfaces:**
- List/read available to authorized organization members with presentation access.
- Create/update/delete restricted to owner/admin/media operator (reuse an explicit exported role set; do not inline ad-hoc role checks in each route).
- Service theme assignment restricted to `LIVE_OPERATOR_ROLES` but does not itself change Program content/state.
- Every write emits audit event without embedding binary media.

- [ ] **Step 1: Add failing RBAC, tenant, built-in immutability, assignment and audit tests.**
- [ ] **Step 2: Implement routes through `presentation-themes.ts` services.**
- [ ] **Step 3: Run theme/RBAC/service tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): expose Theme Studio APIs"`.

---

### Task 3: Build progressive-disclosure Theme Studio UI

**Files:**
- Create: `apps/control/src/app/themes/page.tsx`
- Create: `apps/control/src/components/themes/ThemeStudio.tsx`
- Create: `apps/control/src/components/themes/ThemePreview.tsx`
- Modify: `apps/control/src/app/settings/page.tsx`
- Modify: `apps/control/src/components/navigation/studio-routes.ts`
- Create: `apps/control/scripts/theme-studio-ui-selftest.mjs`

**Interfaces:**
- Essential Cockpit shows active theme name only; `/themes` exposes designer controls.
- Editor sections: Typography, Background, Layout, Lower Third, Logo, Motion.
- Preview fixtures: Scripture, Lyrics, Announcement, Lower Third.
- Save is explicit; unsaved changes do not mutate active service rendering.

- [ ] **Step 1: Write failing UI tests for built-in templates, sections, local preview, safe bounds, 12px floor, 44px mobile controls, and no live TAKE action.**
- [ ] **Step 2: Implement Theme Studio with local draft state and explicit Save/Apply.**
- [ ] **Step 3: Run Theme Studio/navigation/Cockpit tests; expect PASS.**
- [ ] **Step 4: Commit:** `git commit -m "feat(control): add Theme Studio workspace"`.

---

### Task 4: Extend presentation payload with optional appearance

**Files:**
- Modify: `apps/control/src/app/api/v1/edge/presentation/items/[id]/route.ts`
- Create: `apps/control/scripts/edge-presentation-theme-selftest.mjs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Contracts/PresentationRenderItem.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Transport/HttpPresentationContentClient.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Contracts/PresentationAppearance.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/HttpPresentationContentClientTests.cs`

**Interfaces:**
- Edge JSON adds optional `appearance`; old title/body/footer/metadata fields remain unchanged.
- `PresentationAppearance` mirrors only the sanitized version-1 schema and is nullable.
- Missing/unknown appearance results in default renderer behavior.

- [ ] **Step 1: Write failing Control API + C# deserialization/backward-compatibility tests.**
- [ ] **Step 2: Resolve active service theme server-side and include sanitized appearance.**
- [ ] **Step 3: Extend Edge contract/client with nullable appearance.**
- [ ] **Step 4: Run Control theme payload tests + Edge Core tests; expect PASS.**
- [ ] **Step 5: Commit:** `git commit -m "feat(edge): carry presentation appearance contract"`.

---

### Task 5: Render themes consistently in local web + Skia outputs

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/SkiaProgramFrameRenderer.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/RenderedProgramVideoSourceTests.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/PresentationThemeRenderingTests.cs`

**Interfaces:**
- Both renderers map the same appearance fields to bounded rendering primitives.
- Unsupported fonts use the current default typeface; unsupported media/logo assets fail closed to no logo rather than blocking Scripture.

- [ ] **Step 1: Write failing renderer tests for default fallback, alignment/safe area, backing opacity, lower third, logo omission on bad asset, and long Scripture fitting.**
- [ ] **Step 2: Implement shared appearance mapping helpers in Edge Core; keep renderer-specific drawing local.**
- [ ] **Step 3: Run full Edge Core tests and Windows/macOS builds.**
- [ ] **Step 4: Field-UAT built-in templates on 16:9 projector and streaming output; record screenshots/evidence.**
- [ ] **Step 5: Commit:** `git commit -m "feat(edge): render presentation themes"`.
