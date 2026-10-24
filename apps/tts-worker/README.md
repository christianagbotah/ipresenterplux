# iPresenterPlux TTS Worker

Trusted backend worker for translated-audio synthesis.

## Safety model

- Provider defaults to `disabled`; a disabled worker never claims TTS jobs.
- Worker authentication uses a separate bearer credential, preferably from a mode-600 token file.
- Remote control-plane and Ghana voice-provider URLs must use HTTPS; loopback HTTP is allowed only for same-host control-plane deployments.
- One leased job is processed at a time. Provider readiness and synthesis are stop-aware and timeout-bounded.
- A timed-out provider call blocks further claims until that call actually exits, preventing thread accumulation.
- Audio is written atomically to `tts/<job-id>/<lease-token>.<ext>`. An expired worker therefore cannot overwrite audio produced by a newer lease.
- The control plane revalidates the current translated-text SHA-256 and any personalized voice consent before accepting completion.
- Personalized voices require an explicitly consented `voice_profile`; the worker never enrolls or clones a voice from the live microphone automatically.
- Generic provider voices remain separate from personalized voice profiles.
- Routine status contains only state/provider/counts/error codes—never sermon text, audio bytes, tokens, or storage keys.
- Provider credentials stay on the server and are never delivered to the desktop, browser, or audience client.

## Language contract

The interpretation release gate recognizes exactly these canonical target languages:

| Audience language | Canonical code | Accepted aliases |
| --- | --- | --- |
| English | `en` | `en`, `english` |
| French | `fr` | `fr`, `french` |
| Twi / Akan | `ak` | `ak`, `tw`, `twi`, `akan` |
| Ewe | `ee` | `ee`, `ewe` |

Unsupported or ambiguous values fail closed with `unsupported_language`; the worker never guesses a language.

## Provider strategy

### Google Cloud TTS

Google Cloud Text-to-Speech remains the generic English/French provider. It is an optional dependency (`.[google]`) and is never enabled automatically. Configure:

```text
IPRESENTERPLUX_TTS_PROVIDER=google
IPRESENTERPLUX_TTS_GOOGLE_VOICE=fr-FR-Neural2-G
```

The configured Google voice must match the target language. Personalized Google jobs still require a consented Control Plane voice profile whose provider is `google` and whose provider voice ID is present.

### GhanaNLP-compatible voice provider

Twi/Akan and Ewe speech synthesis use the `ghananlp` adapter. The adapter talks only to a trusted HTTPS service endpoint and sends translated text, the canonical language code, and an already-authorized provider voice ID.

The expected provider contract is:

- `GET /health` for readiness.
- `POST /v1/synthesize` with bearer authentication.
- JSON body: `{ "text": "...", "language": "ak|ee|en|fr", "voiceId": "..." }`.
- Successful response: bounded valid WAV audio.

Configure provider secrets in `/home/lightworld/webapps/ipresenterplux/.secrets/tts-provider.env`, not in Git:

```text
IPRESENTERPLUX_TTS_PROVIDER=ghananlp
IPRESENTERPLUX_TTS_GHANANLP_URL=https://trusted-voice-provider.example
IPRESENTERPLUX_TTS_GHANANLP_TOKEN_FILE=/home/lightworld/webapps/ipresenterplux/.secrets/ghananlp-token.txt
IPRESENTERPLUX_TTS_GHANANLP_VOICE=generic-ghana-voice
```

The generic voice ID is optional when every job uses a consented personalized voice profile. A personalized job is accepted only when its stored voice provider is `ghananlp` and a provider voice ID is present. Revoked/expired consent is rejected by the Control Plane completion path.

`tts-provider.env`, the Ghana provider token file, and all other files under `.secrets` must remain server-only and non-world-readable. The systemd unit keeps the provider `disabled` by default and reads the optional private provider environment file at runtime.

## Failure behavior

- TTS failure never removes or hides a successful translated-text result.
- Empty, malformed, wrong-content-type, oversized, or invalid-duration audio is rejected before publication.
- Provider timeout/failure marks only that synthesis job failed; later translation/audio segments remain independently processable.
- If all cloud AI providers are unavailable, local Edge Preview/Program continues to operate.

## Development

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
```

To run safely without consuming synthesis jobs, configure the worker token/control URL and leave:

```text
IPRESENTERPLUX_TTS_PROVIDER=disabled
```

Do not enable Ghana personalized voice synthesis until provider credentials, consented voice profiles, target-language pronunciation, latency, and physical audience playback have passed field UAT.
