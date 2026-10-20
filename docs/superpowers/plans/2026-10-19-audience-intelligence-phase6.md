# Phase 6 — Audience and Intelligence Deepening Plan

**Goal:** Deepen iPresenterPlux audience language/interpretation, searchable service memory, AI service commands and impact-first recovery without granting AI new Program authority.

**Safety invariants:** Audience sessions are anonymous and service-scoped; no IP/device fingerprint/raw user-agent storage. Language choice remains per audience session and independent of projector language. AI uses existing domain services/RBAC and cannot bypass Preview/Program authority. Offline local Program remains independent from Internet audience/AI degradation.

## Task 1 — Anonymous audience language sessions
- [x] Add `045_audience_sessions.sql` with service/org/channel scope, last-seen expiry index, no PII fields.
- [x] Add shared audience-session authority and public heartbeat API.
- [x] Persist one random session UUID per service in browser storage; heartbeat every 20s and on language change.
- [x] Derive channel listener counts from sessions active in the last 45s instead of static counters.
- [x] Add DB/privacy/UI contract self-test, writable-DB safety registration and Control CI step.

## Task 2 — Audience language experience/readiness
- [x] Show translated-text/audio readiness per language and meaningful fallback copy.
- [x] Surface real active listeners in Audience Studio and distinguish text/audio demand.
- [x] Keep 12px operational text / 44px controls and mobile-first behavior.

## Task 3 — Searchable service memory
- [ ] Add archive search over service title, Scripture history and retained transcript text with tenant/RBAC scope.
- [ ] Add compact service-memory summary (Scripture, captions, translations, incidents/actions) without storing unnecessary raw data.
- [ ] Make archive search available to universal find as a read-only result domain.

## Task 4 — AI commands and recovery assistance
- [ ] Layer natural-language intent on existing deterministic command/domain services only.
- [ ] Add impact-first recovery explanations for audience/translation/stream/source degradation.
- [ ] Keep all mutations behind existing RBAC and Preview/Program command authority; no generic AI live path.

## Task 5 — Phase 6 acceptance/UAT
- [ ] Contract tests for tenant/privacy/RBAC/session expiry/AI authority.
- [ ] UX tests for audience language switching, reconnect, degradation and service-memory search.
- [ ] Physical audience UAT across iPhone/Android plus interpreter/operator roles; retain release gate until completed.
