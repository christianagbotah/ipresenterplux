# Audience Live and Streaming Reliability Design

Date: 2026-10-07
Status: Proposed for implementation review
Parent: `2026-10-07-product-readiness-program-design.md`

## Purpose

Make audience viewing and church streaming behave as complete service workflows instead of isolated pages that depend on hidden IDs or stale stream state.

## Current problem

The public `/live` page requires a valid service UUID and only exposes the audience experience when that service is `live`. There is no authenticated Audience workspace that creates, previews or explains the live URL. The latest production stream session is currently stuck in `stopping`, showing that lifecycle reconciliation is also incomplete.

## Audience Studio

Add authenticated `/audience` for church operators/admins. It displays the current organization and service, audience readiness, canonical audience URL, copy-link action, QR code, browser preview, current Scripture/captions/languages/video, program-video transport readiness, and clear actions when the service has not started. Operators must never have to manually construct `?service=<uuid>`.

## Public audience route

Keep `/live` as the public browser experience with explicit states: invalid link, waiting for a valid ready service, live service, ended service, and unavailable/revoked service. A valid waiting page transitions automatically when the service becomes live.

## Program video

Use the existing service MediaMTX path. WebRTC remains preferred and HLS remains fallback. The player reports connecting, live, no publisher, WebRTC failed/HLS available, and stream ended states directly in the page.

## Service lifecycle integration

Starting a service and starting a broadcast remain separate actions, but state must reconcile.

- Active stream states are `starting`, `live` or `stopping`.
- Only one active stream session per service remains enforced.
- Ending a service requests broadcast shutdown when an active stream exists.
- Stale `starting`/`stopping` sessions are reconciled using Edge contribution state, MediaMTX path evidence and bounded age thresholds.
- Reconciliation is idempotent and safe to run periodically.
- A stale session becomes `ended` or `error` with a machine-readable reason; it never remains indefinitely transitional.

## Streaming Studio

Retain `/streaming` but add a true program preview/readiness section. Clearly distinguish master Edge -> MediaMTX contribution, Web audience transport, each social RTMPS transport, provider-confirmed state where available, and provider-unverified state otherwise. RTMPS success is never presented as provider-confirmed social success.

## Destination behavior

Existing YouTube/Facebook/TikTok/custom RTMPS/WebRTC/NDI identities remain authoritative. One failed destination cannot stop the master or healthy destinations. Provider API/OAuth failure cannot stop RTMPS. Internet streaming failure cannot stop local Program/recording. Destination configuration remains locked during starting/live/stopping.

## Audience link security

Phase 1 audience links use the existing service UUID. The authenticated Audience Studio owns link/QR distribution. Future private-event access can add signed audience tokens without changing the program routing contract.

## Realtime updates

Audience and Streaming use the existing service realtime path where available with bounded polling fallback. Manual refresh must not be required for service, Scripture, transcript or stream-state changes.

## Testing

Cover Audience Studio link/QR generation, public-route state matrix, waiting -> live transition, service end with active broadcast, stale-session reconciliation, idempotency, master/destination/provider truth separation, failure isolation, and no-store tenant/service-scoped audience API behavior.

## Acceptance criteria

An operator can click Audience, copy/display a QR code, preview what attendees will see, start a service/broadcast through intended controls, and watch phones transition automatically into the live experience. Ending the service leaves no stream session indefinitely stuck in `starting` or `stopping`.
