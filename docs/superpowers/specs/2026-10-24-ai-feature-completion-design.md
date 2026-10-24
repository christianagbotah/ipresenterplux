# AI Feature Completion Design

## Intent
Close the remaining software-side AI gaps so iPresenterPlux AI Director, live ASR, multilingual interpretation, audience delivery, and service intelligence are operationally complete. After this work, external provider credentials and physical church UAT are deployment gates, not missing product logic.

## Architecture decision
Keep the existing local-first architecture. Edge remains Preview/Program authority. Control orchestrates transcript intelligence, translation/TTS jobs, audience delivery, and service memory. Translation and TTS stay independently degradable; no new model framework or direct AI Program authority is introduced.

## Completion gaps
1. **Readiness is too coarse.** An audio channel with successful translated text but failed TTS is currently presented as one warning. Operators and audience users must see text readiness and voice readiness independently.
2. **Terminal failures lack explicit operator recovery.** Translation jobs auto-retry up to the lease limit, but a terminal failed translation has no requeue action. A failed synthesis job with unchanged text/voice also cannot be cleanly reset because enqueue preserves the terminal status for the same source hash.
3. **Web audio continuation is weaker than mobile.** Mobile retries twice then skips to later audio; web must have the same bounded retry/continue contract.
4. **No single whole-chain AI acceptance gate.** Individual tests exist, but one release gate must prove transcript -> Scripture intelligence -> translation -> synthesis readiness/recovery -> audience projection -> service memory.

## Product behavior
### Text vs voice readiness
`AudienceChannelReadiness` keeps its existing overall state for compatibility and adds two optional facets:
- `text`: caption/translation readiness.
- `voice`: interpreted-audio readiness for audio channels.

For `translation_audio`:
- translated text succeeded + synthesis failed => overall attention, **text ready**, **voice attention**.
- translated text succeeded + synthesis pending/processing => overall preparing, **text ready**, **voice preparing**.
- both succeeded => overall ready, text and voice ready.
This state is surfaced in Audience Studio, Live Audience, and AI Director language demand.

### Operator recovery
Authenticated translation operators get explicit recovery actions:
- Retry terminal failed translation: clear terminal lease/error state, reset attempts, set `pending`, audit and publish realtime event.
- Retry terminal/failed audio synthesis: require a succeeded audio translation, current audio entitlement, valid channel and consent binding; reset synthesis state to `pending`, clear stale provider/audio/lease/error fields, reset attempts, audit and publish realtime event.
Recovery never changes Program and never bypasses entitlements or consent.

### Audio continuation
Web interpreted audio performs bounded retries per segment. After the retry budget, it advances the cursor and continues with later ready segments instead of repeatedly stalling on one asset.

### Language/provider contract
Google Cloud Translation remains valid for `en`, `fr`, `ak`, `ee` (and existing `gaa` compatibility). TTS remains generic Google for configured English/French voices and GhanaNLP-compatible HTTPS for Twi/Akan/Ewe and consent-bound Ghanaian profiles. Unsupported aliases fail closed.

## Security and safety
- No provider credentials in browser/mobile/desktop payloads.
- No automatic voice cloning/enrollment from microphone audio.
- Consent-bound personalized voice rules remain authoritative.
- Recovery endpoints require authenticated translator/operator membership and audit every action.
- AI Director remains advisory; existing guarded Scripture automation remains the only automated live-output exception.
- Source captions/local presentation continue when translation/TTS are unavailable.

## Acceptance criteria
- Four primary languages `en`, `fr`, `ak`, `ee` have pinned readiness coverage.
- TTS failure cannot hide successful translated text.
- Terminal translation and audio jobs can be safely requeued by authorized operators; unauthorized requests fail.
- Web audio skips a terminal playback failure and can continue later segments.
- Whole-chain self-test proves transcript ingest, Scripture recommendation, all four translation targets, text-vs-voice readiness, synthesis recovery, audience state, and ended-service memory.
- Existing AI Director, audience, translation, TTS, voice-consent/binding, Control build, and worker suites remain green.
