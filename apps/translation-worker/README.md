# iPresenterPlux Translation Worker

Trusted backend worker for service-scoped live caption translation.

## Safety model

- Provider defaults to `disabled`; disabled workers never claim jobs.
- The control-plane bearer credential is read from the environment and removed from the process environment after startup.
- Remote control-plane URLs must use HTTPS. Loopback HTTP is allowed for same-host deployments.
- Sermon text is not written to the worker status file or routine logs.
- Jobs use short leases. Expired jobs are reclaimed; completed leases cannot be reused.
- `translation_audio` jobs translate text first. Audio/TTS is a separate downstream stage.

## Providers

`disabled` is always available.

`google` uses Google Cloud Translation through Application Default Credentials and is optional:

```bash
pip install -e '.[google]'
```

No provider package, model, or credential is downloaded automatically by the worker.

## Environment

Required:

- `IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN` **or** `IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN_FILE` (mode 600 recommended; token file is preferred for systemd)

Optional:

- `IPRESENTERPLUX_TRANSLATION_CONTROL_URL` (default `http://127.0.0.1:3011`)
- `IPRESENTERPLUX_TRANSLATION_WORKER_ID` (default `translation-worker-1`)
- `IPRESENTERPLUX_TRANSLATION_PROVIDER` (`disabled` or `google`, default `disabled`)
- `IPRESENTERPLUX_TRANSLATION_POLL_SECONDS` (default `1`)
- `IPRESENTERPLUX_TRANSLATION_LEASE_SECONDS` (default `45`)
- `IPRESENTERPLUX_TRANSLATION_HTTP_TIMEOUT_SECONDS` (default `10`)
- `IPRESENTERPLUX_TRANSLATION_PROVIDER_TIMEOUT_SECONDS` (default `15`, must be shorter than the lease)
- `IPRESENTERPLUX_TRANSLATION_STATUS_PATH` (default `runtime/status.json`)

Run one non-destructive cycle:

```bash
ipresenterplux-translation --once
```

With provider `disabled`, a cycle writes a disabled health/status record and does not claim queued translations.
