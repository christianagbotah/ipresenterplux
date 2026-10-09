# Navigation, Scripture and Operator Usability Design

Date: 2026-10-07
Status: Proposed for implementation review
Parent: `2026-10-07-product-readiness-program-design.md`

## Purpose

Remove the dead navigation experience and make Scripture presentation a complete operator workflow using the Bible content and service state already present in iPresenterPlux.

## Current problem

The dashboard currently displays several menu items with no route. Scripture is one of them even though the database already contains a complete WEBP Bible library and Scripture detection/Preview/Program logic.

The result is misleading: users see a product module but cannot enter it. Manual Scripture selection is also fragmented between dashboard cards and the Operator workspace.

## Navigation model

The primary sidebar becomes route-driven rather than mixed links/dead buttons.

Required routes:

- Control Room -> `/`
- Scripture -> `/scripture`
- Songs & Media -> `/media`
- Cameras -> `/cameras`
- AI Director -> `/ai-director`
- Translations -> `/translations`
- Streaming -> `/streaming`
- Audience -> `/audience`
- Archive -> `/archive`
- Settings -> `/settings`

The current route determines active styling. Capability/RBAC/entitlement checks may hide a route, but a visible menu item must always be actionable.

Desktop-collapsed and expanded sidebars use the same route source. Mobile gets a compact drawer/bottom-sheet representation rather than a second hard-coded navigation list.

## Scripture workspace

`/scripture` is an authenticated church/operator workspace scoped to the user's current organization and current/most relevant service.

Main layout:

1. Bible/version and reference search.
2. Browse controls for version -> book -> chapter -> verse/range.
3. Passage results/current selection.
4. Recent AI detections and service Scripture context.
5. Preview/Program status and operator actions.

### Search

The search input supports direct references such as `John 3:16`, `John 3:16-18`, `Psalm 23`, and recognized aliases/abbreviations where the Bible catalogue provides them.

A text-search mode may search verse text, but direct reference parsing is the first priority because it is the fastest church-service workflow.

Search never queries an external Bible provider during a live service; it uses the local Bible library.

### Browse

Book, chapter and verse controls are derived from `bible_versions`, `bible_books` and `bible_verses`. They must not hard-code canonical counts where the database can provide the truth.

Changing book/chapter updates the available verse range. Operators can select one verse or a contiguous range.

### Preview and Program

The Scripture workspace uses the existing Scripture state transition API and Edge command dispatch.

Safety rules:

- selecting a passage does not change Preview or Program;
- Preview is explicit;
- Take Live is enabled only for the item currently staged in Preview in the new operator surfaces;
- the item already on Program cannot be re-staged as Preview from the new surfaces;
- Clear Program remains explicit;
- cloud state and Edge confirmation are displayed separately.

The server API stays backward-compatible for existing callers during this phase.

## Operator workspace integration

The existing Option A Operator workspace remains the dedicated broadcast console. `/scripture` is the full Bible/manual-selection workspace; `/operator` is the fast service-operation console.

A manually selected Scripture passage creates/reuses the same service Scripture detection/presentation model used by AI detection so there is one Preview/Program pipeline.

The current Operator improvements are preserved: reload-safe selected item; new detections do not steal selection; arrow-key queue navigation; `P` for Preview; `Ctrl/Cmd + Enter` for Take Live; `Ctrl/Cmd + Backspace/Delete` for Clear Program; shortcuts ignored in editable fields.

## Empty/error states

If no service exists, `/scripture` shows the Bible browser plus a clear action to create/open a service; live controls are disabled with explanation.

If a service is ended, manual Bible browsing still works, but Preview/Program controls explain that a ready/live service is required.

If the Bible library is unavailable, the page reports the missing library rather than showing an empty queue.

## RBAC and entitlement

Viewing Scripture content follows authenticated organization access. Live output mutations require the existing live-operator role.

Core local Scripture presentation is treated as a base entitlement and should remain available during the offline entitlement grace period.

## Testing

Automated coverage must include every visible nav item resolving to a real route, active-route styling, reference parsing and verse-range validation, Bible browse queries, manual selection -> Preview -> Program -> Clear, RBAC denial, Operator reload/keyboard safety regression, and mobile/collapsed sidebar link parity.

## Acceptance criteria

A church operator can log in, click Scripture from the sidebar, search `John 3:16`, read the local passage, stage it to Preview, take it to Program, see Edge confirmation separately, clear Program, and return to any other visible module without encountering a dead navigation control.
