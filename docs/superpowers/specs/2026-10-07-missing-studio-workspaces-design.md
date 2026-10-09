# Missing Studio Workspaces Design

Date: 2026-10-07
Status: Proposed for implementation review
Parent: `2026-10-07-product-readiness-program-design.md`

## Purpose

Replace the remaining dead sidebar placeholders with first-phase workspaces that are useful today and honest about hardware/backend readiness.

## General rule

A visible module must provide a usable workflow, provide a truthful status/readiness workspace with an explicit setup action, or be hidden by RBAC/entitlement. It must never be rendered as a dead button.

## Songs & Media (`/media`)

Use existing `presentation_items` and `media_sources` foundations. First phase: list/search service/reusable media, create text/slide/media items, add items to current service rundown, show local/Edge availability, preview metadata/thumbnail where available, send supported items through the Preview -> Program pipeline, and clearly mark unsupported/native-only media types. Songs may initially use structured service-planner content; external song-database integrations are later.

## Cameras (`/cameras`)

Cameras is an operator readiness/routing workspace backed by Edge/media-source telemetry. It lists configured/observed video sources, the reporting Edge device, availability/permission/unsupported state, safe preview when the native path supports it, preferred-source labels for streaming/recording, and a direct link to Edge Devices setup when no production computer is paired. The browser/VPS must never pretend to own capture that actually belongs to the Edge desktop.

## AI Director (`/ai-director`)

AI Director becomes the control/status center for AI-assisted presentation, not an autonomous unreviewed live-output bot. First phase: ASR/detection/translation/TTS health, auto-preview threshold/settings, recent AI recommendations with confidence/evidence, explicit suggestion/auto-preview vs Program authority, service-level enable/disable controls, and links to Scripture/Translations/Operator for correction. Program changes remain human-authorized unless a future separately approved automation mode is introduced.

## Archive (`/archive`)

Archive exposes completed services and retained production artifacts. First phase: ended-service list, service rundown/final Scripture history, retained transcript/caption history, available recordings/media metadata, authorized download/open actions, and clear missing/expired-artifact states. Entitlement may limit retention/storage, but local church metadata is not deleted merely because a subscription expires.

## Cross-workspace service context

All four workspaces use the same current-service semantics as Control Room/Planner/Operator. Without a ready/live service, pages may still show reusable organization assets and a clear action to open/create a service.

## Navigation/active state

All routes participate in the shared sidebar source. Active state derives from pathname rather than hard-coded index position. Sub-routes keep their parent menu item active.

## RBAC and entitlement

Media/rundown editing uses planner/live-operator roles as appropriate. Camera configuration/device administration requires device/admin capabilities; view-only status can be broader. AI settings require authorized operator/admin roles plus relevant AI entitlement. Archive follows organization membership plus artifact-specific role rules. Entitlement controls visibility/actionability, not tenant isolation; server endpoints still enforce organization scope.

## Testing

Cover all four routes for authorized users, sidebar route/link parity and active-state matching, correct setup links from empty states, cross-organization denial, capability/entitlement gating, truthful Edge-owned camera state, absence of direct unreviewed Program action in AI Director Phase 1, and Archive tenant isolation.

## Acceptance criteria

A user can click every visible sidebar item and reach a coherent page. Each page either performs its intended first-phase workflow or clearly tells the user what device/setup/state is required next; no module is a decorative placeholder.
