# Theme Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build reusable, tenant-scoped presentation Themes that are edited away from the live Cockpit, safely assigned per service, and rendered by the local Edge projector path.

**Architecture:** Control Portal owns theme CRUD, role/tenant policy, preview, service assignment and appearance resolution. Theme appearance is a bounded v1 schema: no arbitrary CSS or remote URLs. For live output, Control resolves `base + content variant + output variant` and sends the resolved appearance as presentation metadata; Edge validates/decodes only known tokens and renders them locally.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Zod / PostgreSQL / .NET Edge agent / xUnit.

**Spec:** `docs/superpowers/specs/2026-10-17-ebp-competitive-ux-design.md` on `docs/competitive-ux-ebp` (Theme Studio section and Phase 5 sequence).

## Global Constraints

- Theme Studio is separate from the default live Cockpit; live styling clutter must not return to Essential mode.
- Operational text keeps a 12px floor and important touch targets keep a 44px minimum.
- Built-in themes are immutable; tenant custom themes are tenant-scoped and audited.
- Backgrounds are bounded tokens, local media UUIDs, or hex colors; never arbitrary CSS/remote URLs.
- Program authority remains unchanged: changing/assigning a Theme never performs TAKE or Program mutation.
- Edge remains the projector/local-output authority and must render without an Internet round-trip once presentation content is fetched/cached through the existing path.

## Review Focus

- Malicious/invalid appearance payloads must fail closed rather than reaching Edge as CSS.
- Theme IDs from another tenant must never be readable, editable or assignable.
- Changing a theme during a service must not silently change Program content or issue a TAKE.
- Long Scripture/song text must fit within safe zones without live font-size micromanagement.
- Edge must preserve readable defaults if theme metadata is missing, old, malformed or from a future version.

---

### Task 1: Harden Theme appearance schema

**Files:**
- Modify: `apps/control/db/044_presentation_themes.sql`
- Modify: `apps/control/src/lib/presentation-themes.ts`
- Modify: `apps/control/scripts/presentation-theme-selftest.mjs`

**Interfaces:**
- Produces bounded `PresentationAppearance` background values and built-in theme fixtures.

- [ ] Write/retain failing coverage rejecting arbitrary CSS/URL backgrounds.
- [ ] Implement bounded gradient tokens, hex solid colors and local-media UUID image references.
- [ ] Run `pnpm test:presentation-theme`; expect PASS.
- [ ] Run `pnpm exec tsc --noEmit` and `git diff --check`; expect PASS.
- [ ] Commit `fix(control): bound presentation theme appearance values`.

### Task 2: Add content/output variants and deterministic resolution

**Files:**
- Modify: `apps/control/src/lib/presentation-themes.ts`
- Modify: `apps/control/db/044_presentation_themes.sql`
- Modify: `apps/control/scripts/presentation-theme-selftest.mjs`

**Interfaces:**
- Produces `resolveThemeAppearance(theme, { contentType, output })` where content type is `scripture | song | announcement | generic` and output is `projector | stream | audience`.

- [ ] Add RED tests for Scripture/song/announcement and projector/stream/audience override precedence.
- [ ] Add bounded partial appearance schema for `contentVariants` and `outputVariants`.
- [ ] Merge in order: base -> content variant -> output variant; nested background/lowerThird/logo replace atomically.
- [ ] Verify invalid/future variants fail closed to the built-in default.
- [ ] Commit `feat(control): resolve presentation theme variants`.

### Task 3: Build Theme Studio editor and preview workspace

**Files:**
- Create: `apps/control/src/app/themes/page.tsx`
- Create: `apps/control/src/components/themes/ThemeStudio.tsx`
- Create: `apps/control/src/components/themes/ThemePreview.tsx`
- Create: `apps/control/scripts/theme-studio-ui-selftest.mjs`
- Modify: `apps/control/src/components/navigation/studio-routes.ts`
- Modify: `apps/control/src/components/navigation/StudioSidebar.tsx`
- Modify: `apps/control/src/components/navigation/StudioMobileNav.tsx`
- Modify: `apps/control/src/lib/current-service.ts`
- Modify: `.github/workflows/control-ci.yml`
- Modify: `apps/control/package.json`

**Interfaces:**
- Theme Studio lists built-ins/custom themes, previews variants, clones a built-in into a custom editable theme, and saves through existing `/api/v1/themes` routes.

- [ ] Add RED structural tests for auth/RBAC, route/navigation, immutable built-ins, clone/edit workflow, bounded controls and responsive preview.
- [ ] Add `canThemes` capability for owner/admin/media-operator-equivalent users without granting new live authority.
- [ ] Build editor controls for typography, colors, alignment, safe zone, bounded backgrounds, shadow/backing, logo/lower-third, transition and variants.
- [ ] Keep Program/TAKE controls absent from Theme Studio.
- [ ] Run UI/RBAC/navigation/focus tests and production build.
- [ ] Commit `feat(control): add Theme Studio workspace`.

### Task 4: Add safe per-service Theme assignment

**Files:**
- Create: `apps/control/src/components/themes/ServiceThemeSelector.tsx`
- Modify: `apps/control/src/app/themes/page.tsx`
- Modify: `apps/control/scripts/theme-studio-ui-selftest.mjs`
- Modify: `apps/control/scripts/presentation-theme-selftest.mjs`

**Interfaces:**
- Uses existing `PATCH /api/v1/services/[id]/theme` assignment authority.

- [ ] Add RED tests proving assignment is tenant/RBAC guarded and does not enqueue Program commands.
- [ ] Add current-service selector showing current Theme and a deliberate `Use for this service` action.
- [ ] Keep assignment usable during ready/live service without performing TAKE or changing content state.
- [ ] Commit `feat(control): assign themes safely per service`.

### Task 5: Render resolved Theme on Edge projector output

**Files:**
- Modify: `apps/control/src/app/api/v1/edge/presentation/items/[id]/route.ts`
- Modify: `apps/control/src/lib/presentation-themes.ts`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs`
- Create/Modify tests under `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/`
- Modify: `apps/control/scripts/presentation-theme-selftest.mjs`

**Interfaces:**
- Control response metadata carries a compact versioned resolved theme payload for the `projector` output.
- Edge applies only known gradient/font/alignment/scale/safe-area/animation tokens and local media identifiers.

- [ ] Add RED Control test proving active service theme is included in Edge presentation metadata and cross-tenant themes cannot leak.
- [ ] Add RED Edge renderer tests for known tokens, missing metadata, malformed/future metadata, and HTML/CSS injection strings.
- [ ] Resolve active service Theme for Scripture presentation items and serialize bounded metadata.
- [ ] Extend Edge local renderer to map safe tokens to CSS variables/classes; retain current readable fallback when metadata is absent/invalid.
- [ ] Run Control CI tests, Edge xUnit tests, lint, TypeScript and production build.
- [ ] Commit `feat(edge): render bounded presentation themes`.

### Task 6: Phase 5 acceptance and physical output UAT gate

**Files:**
- Create: `docs/qa/theme-studio-field-uat.md`
- Create: `apps/control/scripts/theme-studio-acceptance-selftest.mjs`
- Modify: `.github/workflows/control-ci.yml`
- Modify: `apps/control/package.json`

- [ ] Protect built-in/custom CRUD, tenant/RBAC, variant precedence, service assignment, no Program mutation, responsive editor and Edge fallback in CI.
- [ ] Document physical projector/preview UAT for Scripture, lyrics, announcement, long text, logo/safe-zone, service Theme switch and offline/local continuity.
- [ ] Require zero unsafe Program mutations and no unreadable fallback before Phase 5 release.
- [ ] Commit `test(control): gate Theme Studio release`.
