# iPresenterPlux ASR Worker

Local speech-recognition service for the Windows/macOS iPresenterPlux Edge Agent. It deliberately runs as a separate process so capture, presentation and offline recording can continue even if model inference fails or is restarted.

## Security and startup defaults

- Binds to `127.0.0.1:8765` by default.
- `IPRESENTERPLUX_ASR_LOCAL_FILES_ONLY=true` by default. The worker will **not** silently download a Whisper model during a church service.
- A non-loopback bind such as `0.0.0.0` is rejected unless `IPRESENTERPLUX_ASR_TOKEN` is configured.
- The Edge Agent itself rejects cleartext remote ASR URLs; HTTP is permitted only on loopback.
- API docs/OpenAPI endpoints are disabled in the runtime worker.
- The bearer token is removed from the worker process environment after configuration is loaded.

## Install

Use Python 3.10+ on the Edge computer. The API shell can be installed without the inference backend:

```bash
python -m pip install .
```

For local Whisper inference:

```bash
python -m pip install ".[local-whisper]"
```

The local inference extra pins the official `faster-whisper` 1.2.1 release. Install or pre-cache the selected model separately before deployment.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `IPRESENTERPLUX_ASR_HOST` | `127.0.0.1` | Worker bind address |
| `IPRESENTERPLUX_ASR_PORT` | `8765` | Worker port |
| `IPRESENTERPLUX_ASR_TOKEN` | unset | Optional bearer token; required for non-loopback bind |
| `IPRESENTERPLUX_ASR_MODEL` | `small` | Faster-Whisper model name or local model path |
| `IPRESENTERPLUX_ASR_MODEL_DIR` | unset | Model/cache directory |
| `IPRESENTERPLUX_ASR_LOCAL_FILES_ONLY` | `true` | Prevent automatic model downloads |
| `IPRESENTERPLUX_ASR_DEVICE` | `auto` | `auto`, `cpu`, `cuda`, etc. |
| `IPRESENTERPLUX_ASR_COMPUTE_TYPE` | `default` | CTranslate2 compute type such as `int8` or `float16` |
| `IPRESENTERPLUX_ASR_LANGUAGE` | auto | Optional fixed language code |
| `IPRESENTERPLUX_ASR_BEAM_SIZE` | `3` | Beam size, 1–10 |
| `IPRESENTERPLUX_ASR_MAX_AUDIO_BYTES` | `1000000` | Maximum request body |
| `IPRESENTERPLUX_ASR_DIARIZATION_PROVIDER` | `disabled` | Speaker diarization provider. Only `disabled` is approved in this build; no model is downloaded automatically. |

Start with:

```bash
ipresenterplux-asr
```

Then point Edge at it:

```text
IPRESENTERPLUX_ASR_URL=http://127.0.0.1:8765
```

## API

`GET /health` is lightweight and never loads the model. `POST /v1/transcribe` accepts `application/octet-stream` PCM signed-16 little-endian mono audio and requires the headers emitted by `HttpSpeechRecognitionEngine`:

- `X-IPresenter-Sample-Rate: 16000`
- `X-IPresenter-Audio-Format: pcm_s16le_mono`
- `X-IPresenter-Started-At: <ISO-8601>`

The model is loaded lazily on the first valid transcription request. If the optional inference dependencies/model are absent, the worker returns HTTP 503 rather than attempting an unexpected download.

## Speaker attribution

The ASR response already carries an optional `speakerId`. Diarization is provider-pluggable but **disabled by default** in this build. When disabled, the worker returns no speaker ID and the control plane may use its audited active-speaker operator fallback. When a future approved diarizer is enabled, its real speaker ID takes precedence automatically. No diarization model is downloaded or activated by this worker today.
