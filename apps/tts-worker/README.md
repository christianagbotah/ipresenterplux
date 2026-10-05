# iPresenterPlux TTS Worker

Trusted backend worker for translated-audio synthesis.

## Safety model

- Provider defaults to `disabled`; a disabled worker never claims TTS jobs.
- Worker authentication uses a separate bearer credential, preferably from a mode-600 token file.
- Remote control-plane URLs must use HTTPS; loopback HTTP is allowed for same-host deployments.
- One leased job is processed at a time. Provider readiness and synthesis are stop-aware and timeout-bounded.
- A timed-out provider call blocks further claims until that call actually exits, preventing thread accumulation.
- Audio is written atomically to `tts/<job-id>/<lease-token>.<ext>`. An expired worker therefore cannot overwrite audio produced by a newer lease.
- The control plane revalidates the current translated-text SHA-256 and any personalized voice consent before accepting completion.
- Personalized voices require an explicitly consented `voice_profile`; generic provider voices remain separate from voice cloning.
- Routine status contains only state/provider/counts/error codes—never sermon text, audio bytes, tokens, or storage keys.
- Google Cloud Text-to-Speech is an optional provider dependency and is not installed or enabled by default.

## Current provider scope

The first validated Google language mapping is French (`fr` → `fr-FR`). Other languages remain blocked until provider support and voice quality are explicitly validated; the worker does not guess ambiguous language codes.

## Development

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
```

To run safely without consuming jobs, configure the worker token/control URL and leave:

```text
IPRESENTERPLUX_TTS_PROVIDER=disabled
```

Do not enable a provider until its credentials, target-language support, voice policy, and production audio quality have been reviewed.

## Optional Google Cloud TTS

Google support is shipped as an optional dependency (`.[google]`) and is never enabled automatically. Set `IPRESENTERPLUX_TTS_PROVIDER=google` only together with Google application credentials and an explicit `IPRESENTERPLUX_TTS_GOOGLE_VOICE` (for the current French channel, an `fr-FR-*` voice). The production service remains `disabled` until deliberately changed.
