# iPresenterPlux — Frontend UX/UI Audit (Phase A)

Reviewer: Z.ai UX Review
Branch: `feat/zai-modern-ux-review-20261010`
Baseline: `main @ 3d5a943`
Scope: authenticated frontend of `apps/control` (the Control Portal).

## Method
Read every cockpit component, the root + operator entry, the studio navigation,
and representative workspace shells (Scripture, Cameras, Media, AI Director).
Cross-checked each finding against the live selftest contracts
(`cockpit-shell`, `cockpit-focus-mode`, `cockpit-acceptance`, `cockpit-predictive-next`,
`camera-workspace`, `media-workspace`, `ai-director`, `operator-workspace`).
Every proposed change is presentational and preserves the exact invariant
strings those selftests assert.

---

## Cross-cutting findings (apply to the whole product)

### CF-1 · Operator typography is too small for live use (P1)
Status badges, Now/Next/Attention section headers, freshness labels and the
footer "Prepare → Assist → Preview → Program → Remember" strip use
`text-[9px]`/`text-[10px]`/`text-[11px]`. The brief explicitly forbids shrinking
important operator information to fit more controls. A volunteer glancing at a
booth monitor cannot read 9px white-on-near-black.

Affected: `CockpitHeader.tsx` (`text-[9px]` status badge), `CockpitWorkspace.tsx`
(footer `text-[10px]`), `ProgramPreviewStage.tsx` (stage labels `text-[10px]`),
`NowRail.tsx`, `NextRail.tsx`, `AttentionLayer.tsx`, `CockpitMobile.tsx`,
`CameraWorkspace.tsx`.

Proposal: introduce a typography scale; raise primary live labels to ≥12px,
section headers to 11px+ with heavier weight, and the footer flow line to 12px.

### CF-2 · Contrast is too low across the board (P1)
Pervasive `text-white/20`, `/22`, `/25`, `/28`, `/30`, `/32`, `/35` for text
that carries real information (empty-state copy, helper text, freshness,
audience counts). Several empty states are almost invisible (`text-white/22`
on `#07090d` is ~1.6:1). The brief requires readable contrast during long
services.

Affected: nearly every cockpit + workspace component.

Proposal: raise informational text to `text-white/55` minimum, captions to
`/45`, and use `/30` only for true chrome. Re-evaluate empty-state copy to
teach, not whisper.

### CF-3 · No state-clarifying motion (P1, under-delivered)
The brief asks for restrained motion that clarifies state: Preview preparation,
Attention entrance, AI recommendation arrival, Focus Mode transition, success
acknowledgement. The current cockpit has effectively zero transition motion —
state changes are instantaneous, which makes "did anything happen?" ambiguous.

Proposal: add a tiny, reduced-motion-respecting set of CSS utilities
(`.ip-preview-prep`, `.ip-ai-arrive`, `.ip-attention-enter`, `.ip-focus-in`)
and apply them at the right moments. No flashy page transitions.

### CF-4 · Program "live" semantics are static (P1)
Program uses a static `border-red-400/20`. There is no visual heartbeat
communicating "this is the live audience output right now". The brief allows
controlled red semantics for Program-live state.

Proposal: a subtle, slow, low-amplitude Program pulse on the live indicator +
border (respecting `prefers-reduced-motion`). Never on the whole surface.

---

## Cockpit flagship (Phase C priority)

### CK-1 · Program/Preview dominance is correct but feels equal-weight (P1)
Grid `lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]` (selftest-locked) makes
Program ~35% wider than Preview — good. But both are equal aspect-video boxes
with near-identical framing, so the eye does not immediately know which is
live. Empty-state copy is `text-white/22` (near-invisible).

Proposal: keep the locked grid ratio; differentiate via (a) a live Program
heartbeat + "ON AIR" affordance, (b) stronger Preview staging cue, (c)
readable empty-state copy that teaches ("Preview is safe staging" / "Program
is clear — audience sees black").

### CK-2 · TAKE is good, but the helper row around it is low-contrast noise (P2)
TAKE (`min-h-14`, gold) is unmistakable — keep. But it sits in a 3-col row with
helper text `text-white/32` and Clear Program `text-white/28`. The safety
helper line ("AI prepares → Preview → human TAKE → Program") should be the
most readable thing in that row, currently the least.

Proposal: raise the safety line to a readable weight; keep TAKE/Clear exactly
as-is (selftest-locked sizes + copy).

### CK-3 · Next rail omits freshness (P1)
`CockpitNextItem` carries `observedAt`/`freshUntil` but `NextRail.tsx` does
not display freshness. The brief explicitly lists freshness as a required
recommendation field ("detected 8s ago", "observed live", "pinned 3 min ago").

Proposal: render a compact freshness line per recommendation.

### CK-4 · Now rail is tall but sparse (P2)
`xl:min-h-[600px]` forces height; freshness rows are color-only-ish. The
speaker transcript line-clamps to 5 then trails off.

Proposal: keep height, add a non-color freshness affordance (text label +
dot), and make the transcript read like a live caption.

### CK-5 · Attention trigger uses magic-pixel offsets (P2)
`AttentionLayer` button is `fixed bottom-20 right-[178px]` to dodge the
Command button (`right-4`). Brittle to layout changes.

Proposal: group the two floating controls in one anchored cluster with a
shared container so offsets are internal, not absolute-to-viewport.

### CK-6 · Command palette placeholder/empty copy is near-invisible (P2)
`text-white/25` placeholder, `text-white/38` hint. Operators typing under
pressure need legible affordance.

Proposal: raise to readable weights; keep all command safety copy
("Program remains human-authorized").

---

## Workspaces (Phase D)

### WS-1 · Cameras opens with a 3-tile count summary (P1)
`CameraWorkspace` leads with "Available / Needs attention / Preferred source"
as `text-3xl` numbers — reads like a dashboard KPI wall. The brief warns
against this even for secondary screens.

Proposal: convert to a single calm readiness strip (one line, words not
giant numbers) while keeping the required strings
("Edge camera sources", "Preferred source", "Permission required",
"Manage Edge Devices").

### WS-2 · Workspace headers repeat a full sticky header per page (P2)
Each workspace re-implements an 86px→240px sidebar grid + sticky header.
Consistent, but the header chrome (status, campus, operator link) varies in
detail across pages.

Proposal: leave the shell intact (tests rely on it); align the header
content density + contrast so every workspace feels like one product.

### WS-3 · Scripture/Archive/Planner tables and density (P2, deferred detail)
To be detailed per-workspace during Phase D; tables must keep sticky headers,
readable rows, visible action affordances.

---

## Responsive / Mobile (Phase E)

### RM-1 · Mobile Cockpit is role-aware already (good) but low-contrast (P2)
`CockpitMobile` correctly projects 5 profiles. Copy is `text-white/35`–`/40`.

Proposal: contrast pass only; do not change profile gating (tests + RBAC).

### RM-2 · Mobile nav is a `<details>` sheet (good)
`StudioMobileNav` uses a native disclosure — accessible, no JS. Keep.

---

## Accessibility

### A11Y-1 · Color-only freshness (P2)
Camera/audio freshness is text+color in `NowRail` (acceptable), but the
Edge/Camera freshness dot in `FocusMode` and `CockpitMobile` leans on color.

Proposal: pair every dot with a text label.

### A11Y-2 · Reduced motion not handled (P1)
No `prefers-reduced-motion` guards anywhere (because there's no motion yet).
As motion is added (CF-3), it must be gated.

### A11Y-3 · Focus-visible rings exist but are ad-hoc (P2)
`focus-visible:ring-[#e2b85f]` is used in many places but inconsistently.
The gold ring is a good choice; standardize via a `.ip-focus-gold` utility.

---

## Severity rollup
- P0 (live-operation confusion/danger): none identified. The safety model
  (Preview → human TAKE → Program) is intact and well-locked by tests.
- P1: CF-1, CF-2, CF-3, CF-4, CK-1, CK-3, WS-1, A11Y-2.
- P2: CF-4 detail, CK-2, CK-4, CK-5, CK-6, WS-2, WS-3, RM-1, A11Y-1, A11Y-3.

## Non-goals (locked by tests / safety — will NOT touch)
- Program mutation authority, RBAC, entitlement gates, Edge truth model,
  DB schemas, the `lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]` ratio,
  `>TAKE<` / `Clear Program` / `Ctrl/⌘ + Enter` / `min-h-14` / `min-h-12`,
  the 5 mobile profile data-attributes, recommendation/attention/command
  safety strings.
