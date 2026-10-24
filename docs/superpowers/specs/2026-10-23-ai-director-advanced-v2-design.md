# AI Director Advanced V2 Design

## Intent
Turn the existing AI foundations into one usable live-service intelligence layer. The operator should see what the system is hearing, what it predicts should come next, which languages the audience is actually using, and what the service learned after it ends.

## Product decision
Use a local-first, advisory-first architecture. Edge/desktop remains authoritative for physical Preview/Program. Cloud intelligence can recommend, auto-preview Scripture under existing policy, and only auto-live Scripture when the existing guarded organization/service policy is explicitly armed.

## Scope
1. Integrate audience-language intelligence and service-intelligence memory already developed on `feat/service-intelligence-memory-v2` into the current field desktop line.
2. Extend AI Director state with a bounded live transcript window, speaker/ASR confidence, predictive-next items, audience language demand/readiness, and memory availability.
3. Redesign AI Director into Live Sermon, Smart Next, Language Demand, Health, and Automation surfaces.
4. Add desktop Operator links/status so the production PC can open AI Director and Translations without leaving the live desktop workflow.
5. Keep all queries tenant/service scoped and bounded; no model/provider secrets may reach browser or desktop.

## Non-goals for this pass
- No unguarded AI mutation of Program.
- No autonomous camera switching.
- No voice cloning without explicit voice-consent/binding governance.
- No dependency on an external LLM for the core service path; existing ASR, Scripture intelligence, translation/TTS workers, and deterministic predictive/memory layers remain functional when external model providers are unavailable.

## Approaches considered
- Replace current operator workflow with a cloud AI console: rejected because it weakens offline resilience and physical-output authority.
- Add a separate new AI microservice: deferred because the repo already has proven Cockpit, Scripture automation, translation/TTS and memory contracts.
- **Chosen:** consolidate the existing proven branches and project their state into AI Director V2 and the desktop Operator. This minimizes duplication and preserves existing safety boundaries.

## Live AI Director model
- `liveTranscript`: last 12 current-service transcript segments, newest first; text bounded to 500 chars each; speaker/source language/ASR confidence/observed time included.
- `smartNext`: top 8 items from existing predictive-next projection, preserving planned/recommendation/pinned source and confidence/reason.
- `languageDemand`: enabled language channels plus active audience-session counts and latest activity; ordered by listener count then language.
- `memory`: for ended/archived service, expose ready/pending/failed state and summary/chapter count when available.

## UI behavior
- Live Sermon shows the newest speech with speaker label, language, confidence and age.
- Smart Next explains why an item is recommended; AI Director remains advisory and links to the Cockpit/Scripture workspace for actions.
- Language Demand makes audience demand visible before enabling costly voice channels.
- AI Health keeps ASR, text translation and voice translation heartbeat truth visible.
- Desktop shows current mic/ASR truth and links directly to AI Director and Translations.

## Safety and failure behavior
- Stale or absent transcript data renders as unavailable, not invented content.
- Smart Next uses existing freshness filters and never creates direct Program mutations in AI Director.
- Audience sessions are anonymous and aggregated.
- Memory generation is post-service and best-effort; failure never blocks ending a service.
- All AI panels degrade independently; presentation and Program continue locally.