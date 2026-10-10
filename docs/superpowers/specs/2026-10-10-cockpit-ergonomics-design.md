# Cockpit Ergonomics Design

## Goal
Keep Preview and Program continuously visible during desktop live operation, restore true 16:9 stage geometry, improve readability and pointer affordance, and make the Create Service dialog safe on short viewports.

## Approved behavior
- Preview and Program remain true landscape 16:9 surfaces; responsive width may change but forced minimum heights must not distort them.
- On desktop, the live stage (Preview, Program, TAKE and Clear) stays sticky beneath the 68px Cockpit header while supporting rails can scroll independently.
- The Now and Next rails use viewport-bounded independent vertical scrolling at the wide desktop breakpoint. On narrower desktop/tablet layouts they remain in normal document flow around the sticky live stage; mobile keeps its existing stacked experience.
- Preview → TAKE → Program remains the safety boundary. No authorization, mutation, keyboard-safety, or domain-control semantics change.
- Create Service opens with safe top clearance and a viewport-bounded internally scrollable panel so the service title field cannot be hidden above the viewport.
- Enabled links, buttons and button-like controls show a pointer cursor on hover-capable pointer devices. Disabled controls show not-allowed.
- Tiny operational labels in the touched Cockpit/header/modal surfaces move from 10–11px to Tailwind `text-xs` (12px), and explanatory copy may move from `text-xs` to `text-sm` where space allows.

## Layout
The Cockpit desktop grid remains Now | Stage | Next. At `xl`, Now and Next become bounded scroll regions (`max-height: calc(100dvh - 7rem)`, `overflow-y-auto`, `overscroll-contain`). The stage column uses `position: sticky` with a top offset of 84px, clearing the existing 68px sticky Cockpit header and leaving a 16px breathing gap.

The stage surfaces use `w-full aspect-video` with no competing minimum height. Preview remains the smaller 1fr stage and Program the dominant 1.35fr stage.

## Modal
The Create Service backdrop becomes an overflow-y-auto top-aligned container with explicit top/bottom padding on `sm+`. The dialog gets a viewport-relative maximum height and its existing internal scroll behavior remains. Mobile keeps the bottom-sheet shape.

## Verification
A structural self-test protects stage geometry, sticky/bounded desktop layout, modal top clearance, shared pointer affordance, disabled cursor behavior, and the typography floor in the touched UI. Existing Cockpit, planner, lint and production-build checks remain authoritative for behavior and compilation.
