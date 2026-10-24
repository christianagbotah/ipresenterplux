# AI Multilingual Interpretation Completion Design

## Intent
Finish the remaining AI interpretation gap after AI Director V2: make English, French, Twi/Akan and Ewe first-class live interpretation targets, with safe text translation, consent-bound translated voice synthesis, resilient audience delivery, and visible readiness/failure state.

## Product decision
Keep the existing local-first architecture. Edge owns physical Preview/Program. The Control Plane owns translation/TTS jobs and audience delivery. Translation and speech synthesis may fail independently without blocking local presentation or captions.

## Goals
- Support canonical target languages English (`en`), French (`fr`), Twi/Akan (`ak`) and Ewe (`ee`).
- Accept human-friendly aliases such as `twi`, `tw`, `akan`, and `ewe`, then normalize them before provider calls.
- Preserve the current Google text-translation provider while making the supported language contract explicit and testable.
- Preserve generic Google TTS for validated languages and add a GhanaNLP-compatible HTTP TTS provider for Ghanaian-language synthesis and consent-bound voice profiles.
- Never clone or imitate a preacher automatically. A personalized voice requires an existing consented `voice_profile` and provider voice/profile identifier.
- Keep translated text available to the audience even when TTS is unavailable or fails.
- Surface text-ready versus voice-ready state separately so operators can see whether a language channel is fully usable.

## Non-goals
- No automatic voice enrollment from live microphone audio.
- No secret/provider credential delivery to browser, mobile, or desktop clients.
- No direct AI mutation of Program beyond the already-governed Scripture automation exception.
- No claim that a provider preserves accent perfectly; voice quality remains a field-UAT gate.

## Language contract
- `en`, `english` -> `en`
- `fr`, `french` -> `fr`
- `ak`, `tw`, `twi`, `akan` -> `ak`
- `ee`, `ewe` -> `ee`
- Unsupported values fail closed with `unsupported_language` rather than being guessed.

## Provider strategy
### Text translation
Google Cloud Translation remains the primary provider. The worker sends canonical language codes. Provider failures remain lease-bounded and do not remove the source transcript.

### Generic speech
Google TTS remains available for configured, validated BCP-47 voice names. It must not silently select an arbitrary voice. Existing French behavior remains compatible.

### Ghanaian-language / consent-bound speech
Add a provider named `ghananlp` using a configurable trusted HTTPS endpoint. It receives only the translated text, canonical target language, and a provider voice/profile id when a consented voice profile is bound. It may also use an explicitly configured generic provider voice for non-personalized channels.

The worker validates response size, content type/audio bytes, timeout, HTTPS policy, and language/profile consistency before accepting synthesized audio.

## Voice consent and identity
- Existing voice-consent and voice-binding tables/contracts remain authoritative.
- Personalized synthesis requires `voice_profile_id`, `voice_provider=ghananlp`, and a non-empty provider voice id.
- No profile means no personalized voice. The worker may use a configured generic voice only when explicitly configured.
- Revoked/expired consent continues to be rejected by the Control Plane completion path.

## Audience behavior
- Text translation is shown as soon as translation succeeds.
- Audio appears only after synthesis succeeds and the existing audience audio queue authorizes the service/channel.
- Mobile/web playback continues segment-by-segment and skips failed audio segments without stalling later speech.
- Readiness distinguishes transcript, translation, and synthesis so a text-only channel does not look voice-ready.

## Failure behavior
- ASR down: presentation continues; interpretation reports ASR unavailable.
- Translation down: source transcript continues; target text/audio pause.
- TTS down: translated text continues; audio channel reports unavailable/degraded.
- Provider timeout or malformed audio: fail the leased job, never publish partial audio, continue later segments.
- Network loss: Edge presentation remains local; cloud interpretation resumes when connectivity returns.

## UAT gates
- English, French, Twi and Ewe text translation fixtures pass provider/queue contracts.
- French generic TTS regression remains green.
- Twi and Ewe GhanaNLP-provider synthesis contracts pass with fake provider responses in CI.
- Consented personalized profile routes to the correct provider voice id; missing/mismatched profile fails closed.
- Audience queue plays later segments after a failed audio segment.
- AI Director reports text/voice readiness accurately per language channel.
