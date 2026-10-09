# iPresenterPlux Product Readiness Program Design

Date: 2026-10-07
Status: Proposed for implementation review
Owner: Lightworld Technologies Ltd

## Goal

Turn the current iPresenterPlux foundation into an easy-to-use, sellable church production product with complete navigation, usable Scripture operation, working audience/live surfaces, reliable streaming lifecycle handling, and online subscription activation.

The approved user outcome is simple: a church installs iPresenterPlux, activates it with a subscription product key, pairs its production computer, prepares a service, presents Scripture/media, streams or serves the local audience, and can keep operating through a temporary Internet outage.

## Verified current-state findings

- The production Bible library is populated: 66 books and 31,103 verses.
- The dashboard sidebar currently renders Scripture, Songs & Media, Cameras, AI Director, Audience and Archive with no route (`href=null`), so they are intentionally dead controls.
- `/live` currently requires a valid service UUID and only renders the audience experience while that service is `live`.
- Production currently has one service, `Sunday Worship Service`, in `ended` state; there is no current live Scripture item.
- The latest stream session is recorded as `stopping`, so the streaming lifecycle needs stale-session reconciliation.
- Existing reusable foundations include organizations, campuses, services, presentation items, Scripture detections/context, Bible versions/books/verses, output destinations, stream sessions/destinations, Edge devices and credentials, pairing codes, translations/TTS, media sources, audit events, RBAC, and provider credentials/OAuth.

## Program decomposition

This program is intentionally split into four independently testable workstreams. Each workstream has its own design document and should receive its own implementation plan and review gate.

1. Navigation, Scripture and core operator usability.
2. Audience live experience and streaming lifecycle reliability.
3. Online subscription/product-key activation and entitlements.
4. Songs & Media, Cameras, AI Director and Archive first-phase workspaces.

The workstreams share the existing organization/service/Edge identity model. They must not create parallel tenant, service, device or media identity systems.

## Cross-cutting UX rules

- No visible navigation control may be dead. A displayed sidebar item must route to a real workspace or be omitted by capability/entitlement.
- All clickable controls use pointer cursor, clear hover/focus states, disabled explanations and accessible labels.
- Operator-facing state must distinguish cloud intent from physical Edge confirmation.
- Empty/error/not-ready states explain exactly what the user should do next.
- Service lifecycle is the central context: ready -> live -> ended. Live features must explain when no service is currently live.
- The Option A operator flow remains Queue -> Selected -> Preview -> Program with explicit Take Live and Clear Program actions.
- Destructive/live actions remain deliberate; keyboard shortcuts may speed operation but must not bypass Preview/Program safety rules.

## Cross-cutting reliability rules

- GitHub remains source of truth. Production deploys through the existing health-gated VPS pull deployer.
- Database-writing self-tests remain blocked against production databases.
- Stream/device/provider failures are isolated. A provider failure must not stop local Program or unrelated destinations.
- Runtime secrets, stream keys, activation secrets and signing keys never enter Git, browser payloads or logs.
- All subscription/activation mutations are auditable.

## Delivery order

Recommended sequence:

1. Navigation + Scripture workspace, because it removes obvious dead UI and gives the operator a complete core task.
2. Audience + streaming reconciliation, because it repairs the live experience and removes stale broadcast states.
3. Subscription activation, because activation should gate a working product rather than hide unfinished routes.
4. Missing studio workspaces, progressively replacing placeholders with useful first-phase tools.

The existing Operator-console safety work may be merged independently if CI is green; this program must preserve its reload-safe selection and broadcast shortcut contract.

## Acceptance at program level

The product is ready for commercial field UAT when:

- every visible sidebar item opens a real page;
- Scripture can be browsed/search-selected, previewed, taken live and cleared;
- audience links/QR codes are generated from the current service and the live page transitions correctly between waiting/live/ended states;
- starting/stopping/ending services cannot leave stream sessions permanently stale;
- product activation works online and an already activated desktop can continue through the documented offline grace period;
- entitlement expiry/revocation degrades premium capabilities cleanly without deleting church content;
- Windows/macOS desktop artifacts enforce entitlement state without embedding a recoverable master product-key algorithm;
- all workstreams pass CI, production build and documented UAT checks.
