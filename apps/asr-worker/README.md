# iPresenterPlux ASR Worker

Local speech-recognition and optional speaker-attribution service for the Windows/macOS iPresenterPlux Edge Agent. It runs as a separate process so capture, presentation and offline recording continue even if inference is restarted.

## Security and startup defaults

- Binds to `127.0.0.1:8765` by default.
- `IPRESENTERPLUX_ASR_LOCAL_FILES_ONLY=true` by default. Whisper weights are never silently downloaded during a service.
- Speaker attribution is `disabled` by default and never downloads a model at runtime.
- A non-loopback bind is rejected unless `IPRESENTERPLUX_ASR_TOKEN` is configured.
- The Edge Agent rejects cleartext remote ASR URLs; HTTP is allowed only on loopback.
- API docs/OpenAPI endpoints are disabled.
- The bearer token is removed from the process environment after configuration is loaded.

## Install

Use Python 3.10+ on the church Edge computer. API shell only:

```bash
python -m pip install .
```

Local Whisper:

```bash
python -m pip install ".[local-whisper]"
```

Optional local speaker embeddings:

```bash
python -m pip install ".[speaker-diarization]"
```

The speaker extra pins SpeechBrain 1.1.1. iPresenterPlux does not download its model. Pre-stage the Apache-2.0 `speechbrain/spkrec-ecapa-voxceleb` files into a local directory before enabling the provider.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `IPRESENTERPLUX_ASR_HOST` | `127.0.0.1` | Worker bind address |
| `IPRESENTERPLUX_ASR_PORT` | `8765` | Worker port |
| `IPRESENTERPLUX_ASR_TOKEN` | unset | Bearer token; required for non-loopback bind |
| `IPRESENTERPLUX_ASR_MODEL` | `small` | Faster-Whisper model name or local model path |
| `IPRESENTERPLUX_ASR_MODEL_DIR` | unset | Whisper model/cache directory |
| `IPRESENTERPLUX_ASR_LOCAL_FILES_ONLY` | `true` | Prevent Whisper model downloads |
| `IPRESENTERPLUX_ASR_DEVICE` | `auto` | `auto`, `cpu`, `cuda`, etc. |
| `IPRESENTERPLUX_ASR_COMPUTE_TYPE` | `default` | CTranslate2 compute type |
| `IPRESENTERPLUX_ASR_LANGUAGE` | auto | Optional fixed language code |
| `IPRESENTERPLUX_ASR_BEAM_SIZE` | `3` | Beam size, 1–10 |
| `IPRESENTERPLUX_ASR_MAX_AUDIO_BYTES` | `1000000` | Maximum request body |
| `IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER` | `disabled` | `disabled` or `speechbrain_ecapa` |
| `IPRESENTERPLUX_ASR_DIARIZATION_MODEL_DIR` | unset | Required local SpeechBrain model directory when enabled |
| `IPRESENTERPLUX_ASR_DIARIZATION_SIMILARITY` | `0.72` | Session speaker cosine-similarity threshold |
| `IPRESENTERPLUX_ASR_DIARIZATION_MAX_SPEAKERS` | `12` | Maximum anonymous speakers per service session |
| `IPRESENTERPLUX_ASR_DIARIZATION_SESSION_TTL_SECONDS` | `21600` | In-memory speaker-session expiry |

Start with:

```bash
ipresenterplux-asr
```

Point Edge at it:

```text
IPRESENTERPLUX_ASR_URL=http://127.0.0.1:8765
IPRESENTERPLUX_SERVICE_ID=<current-service-uuid>
```

## API

`GET /health` is lightweight and never loads the Whisper or speaker model. `POST /v1/transcribe` accepts PCM signed-16 little-endian mono audio and the Edge headers:

- `X-IPresenter-Sample-Rate: 16000`
- `X-IPresenter-Audio-Format: pcm_s16le_mono`
- `X-IPresenter-Started-At: <ISO-8601>`
- `X-IPresenter-Service-Id: <service UUID>` when a service is active

The service ID is the isolation boundary for stable anonymous speaker IDs. Without it, ASR still works but no automatic `speakerId` is produced.

## Stable speaker attribution

When `speechbrain_ecapa` is enabled, each valid 16 kHz chunk is embedded locally and matched only against speakers already seen in the same service. IDs such as `speaker-001` are session-local anonymous labels; they are not biometric identities and are never reused across services. The control plane may map a session speaker to a consented voice profile, or an operator can use the audited active-speaker fallback.

Diarization/embedding failure never fails ASR text. If the optional speaker engine is unavailable, the worker returns the transcript with `speakerId: null`.
