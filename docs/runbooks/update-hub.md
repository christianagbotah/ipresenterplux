# Lightworld Desktop Update Hub Runbook

This runbook operates the shared Lightworld desktop update service used by iPresenterPlux. The service is intentionally separate from the iPresenterPlux Control Plane so update delivery can remain stable even while the product web application is being deployed.

## Fixed production contract

- Public origin: `https://updates.lightworldtech.com`
- Service bind: `127.0.0.1:3041`
- Application checkout: `/home/lightworld/update-hub/app`
- Public immutable storage: `/home/lightworld/update-hub/public`
- Public trees: `releases/`, `manifests/`, `deltas/`
- Private operational state/logs: `/home/lightworld/update-hub/logs`
- Service unit: `lightworld-update-hub.service`
- Runtime account: `lightworld:lightworld`
- Production channels: `beta`, `stable`
- Release signatures: Ed25519 detached signatures over canonical manifest bytes
- The release private key must never be stored in Git, public storage, the installer, the desktop app, or the Update Hub service environment.

## One-time VPS bootstrap

Run the bootstrap as root. Keep the repository and public trees non-world-writable.

```bash
install -d -o lightworld -g lightworld -m 0750 /home/lightworld/update-hub/app
install -d -o lightworld -g lightworld -m 0755 /home/lightworld/update-hub/public
install -d -o lightworld -g lightworld -m 0755 /home/lightworld/update-hub/public/releases
install -d -o lightworld -g lightworld -m 0755 /home/lightworld/update-hub/public/manifests
install -d -o lightworld -g lightworld -m 0755 /home/lightworld/update-hub/public/deltas
install -d -o lightworld -g lightworld -m 0750 /home/lightworld/update-hub/logs
install -d -o root -g root -m 0700 /root/lightworld-release-signing
```

Clone the repository into `/home/lightworld/update-hub/app` using the same approved GitHub identity already used for Lightworld deployments. Production should ultimately track the reviewed `main` commit, not a developer worktree.

## PostgreSQL

Create a dedicated database and least-privilege login. Do not reuse the Control Plane database account.

Example names:

```text
Database: lightworld_update_hub
Role: lightworld_update_hub
```

Before every production migration, take a timestamped PostgreSQL backup and keep it outside the public release tree. The guarded deploy script does this automatically with `pg_dump --format=custom` before applying the schema. For a manual deployment:

```bash
install -d -o lightworld -g lightworld -m 0750 /home/lightworld/update-hub/backups
pg_dump --format=custom \
  --file="/home/lightworld/update-hub/backups/update-hub-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$UPDATE_HUB_DATABASE_URL"
```

Apply the schema with the dedicated database URL:

```bash
psql "$UPDATE_HUB_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f /home/lightworld/update-hub/app/apps/update-hub/db/001_update_hub.sql
```

The migration is idempotent for the initial tables/index and may be run again during recovery.

## Environment file

Create `/home/lightworld/update-hub/app/.env`, owned by `lightworld:lightworld`, mode `0600`.

```dotenv
UPDATE_HUB_PUBLIC_ORIGIN=https://updates.lightworldtech.com
UPDATE_HUB_DATABASE_URL=postgresql://<dedicated-user>:<password>@127.0.0.1:5432/lightworld_update_hub
UPDATE_HUB_PUBLIC_ROOT=/home/lightworld/update-hub/public
UPDATE_HUB_HOST=127.0.0.1
UPDATE_HUB_PORT=3041
UPDATE_HUB_ADMIN_TOKEN=<random value of at least 32 bytes>
```

Generate the admin token on the VPS, for example:

```bash
openssl rand -hex 32
```

Never echo the real token into deployment logs, tickets, Git commits, screenshots, or public chat.

## Build and install the service

```bash
cd /home/lightworld/update-hub/app/apps/update-hub
pnpm install --frozen-lockfile
pnpm test
pnpm build

install -o root -g root -m 0644 \
  /home/lightworld/update-hub/app/deploy/systemd/lightworld-update-hub.service \
  /etc/systemd/system/lightworld-update-hub.service

systemctl daemon-reload
systemctl enable --now lightworld-update-hub.service
systemctl is-active lightworld-update-hub.service
curl -fsS http://127.0.0.1:3041/health
```

If the service does not become healthy, inspect only bounded recent logs and do not print environment values:

```bash
journalctl -u lightworld-update-hub.service -n 100 --no-pager
```

## Nginx / Cloudflare

Use `deploy/nginx/updates.lightworldtech.com.conf` inside the HTTPS virtual host for `updates.lightworldtech.com`.

Required behavior:

- `/api/` and `/health` proxy to `127.0.0.1:3041` and are `no-store`.
- `/releases/`, `/manifests/`, and `/deltas/` are served directly from the public tree with immutable long caching and byte-range support.
- Admin routes are under `/api/` and therefore must never be cached by Cloudflare.
- Public update downloads must use HTTPS.

After changing the virtual host:

```bash
nginx -t
systemctl reload nginx
curl -fsS https://updates.lightworldtech.com/health
```

Verify Range support against a real published package:

```bash
curl -sS -D - -o /dev/null -H 'Range: bytes=0-1023' \
  https://updates.lightworldtech.com/releases/<package>.zip
```

Expected status is `206 Partial Content` and an `Accept-Ranges: bytes` response.

## Release signing key

Generate the production Ed25519 key on an operator-controlled system or restricted VPS root directory. The private signing key must remain **outside the public tree** (`/home/lightworld/update-hub/public`) and outside the repository.

Example with OpenSSL:

```bash
umask 077
openssl genpkey -algorithm Ed25519 \
  -out /root/lightworld-release-signing/ipresenterplux-ed25519.pem
openssl pkey \
  -in /root/lightworld-release-signing/ipresenterplux-ed25519.pem \
  -pubout \
  -out /root/lightworld-release-signing/ipresenterplux-ed25519-public.pem
chmod 0600 /root/lightworld-release-signing/ipresenterplux-ed25519.pem
```

Only the public key/key-id catalog is bundled into the desktop updater. A private signing key found under the public release tree is a release-blocking incident.

## Build the Windows release

Use the Edge Agent CI artifact produced from the exact reviewed release commit. The Windows artifact contains:

- `iPresenterPlux-Setup.exe`
- the managed `current/` application tree
- `Lightworld.Update.Helper.exe` at the install root
- the full update ZIP
- SHA-256 metadata and manifest template

Do not publish an installer from a failed or partially completed CI run.

### Windows publisher trust

The current internal UAT installer is not yet Authenticode-signed. Windows SmartScreen may therefore display **Unknown publisher** during installation. That is acceptable only for controlled internal/UAT testing where the installer SHA-256 is verified against CI. Before general customer distribution, sign the installer and shipped Windows executables with a Lightworld Technologies code-signing certificate and verify the signature in release CI. The Ed25519 update-manifest signature protects update authenticity, but it does not replace Windows Authenticode publisher trust.

## Build an incremental delta

When both old and new full application trees are available:

```bash
cd /home/lightworld/update-hub/app/apps/update-hub
node scripts/build-delta.mjs \
  --from-dir /path/to/old/current \
  --to-dir /path/to/new/current \
  --from-version <old-version> \
  --to-version <new-version> \
  --output /home/lightworld/update-hub/public/deltas/<old>-to-<new>.zip
```

A desktop chooses a delta only when it exactly matches the installed version and is smaller than the signed full package. If delta verification/application fails, the helper prepares the signed full package instead before the running desktop is asked to exit.

## Sign a release manifest

The signer reads the private key from an explicit restricted path and writes only the detached signature. It canonicalizes the manifest, atomically writes those exact canonical bytes to the public manifest path, and signs those same bytes so the desktop verifies precisely what is served.

```bash
cd /home/lightworld/update-hub/app/apps/update-hub
node --import tsx scripts/release-cli.mjs sign \
  --manifest /home/lightworld/update-hub/public/manifests/<manifest>.json \
  --private-key /root/lightworld-release-signing/ipresenterplux-ed25519.pem \
  --key-id <production-key-id> \
  --signature /home/lightworld/update-hub/public/manifests/<manifest>.sig \
  --public-root /home/lightworld/update-hub/public
```

The command must fail if the private key is placed inside the public tree.

## Release administration

All mutation endpoints require:

```http
Authorization: Bearer <UPDATE_HUB_ADMIN_TOKEN>
X-Lightworld-Actor: <operator identity>
```

Release mutations are audited in `release_events`. Use the authenticated admin API to create/register a release, attach immutable artifacts, publish, change rollout percentage, pause, withdraw, or promote only after UAT. Never expose the bearer token in shell history; prefer a protected environment variable or root-readable temporary header file.

## UAT promotion sequence

1. Publish the new build to `beta` with a limited rollout.
2. On a clean Windows machine, install using `iPresenterPlux-Setup.exe` once.
3. Pair the Edge device and confirm Control Plane/assignment connectivity.
4. Confirm a newer beta is detected and downloaded without stopping presentation, recording, audience streaming, church streaming, or the Edge runtime.
5. Confirm the UI remains in `Update ready — restart when convenient` while any live activity is present.
6. Stop live activity and apply the update. Confirm the helper waits for the parent desktop process before switching `current/`.
7. Confirm the updated desktop creates its health marker only after settings/bootstrap complete.
8. Test a deliberately unhealthy UAT build and verify automatic rollback restores `previous/`.
9. Verify a valid delta update, then intentionally corrupt a delta and prove the signed full-package fallback succeeds before exit.
10. Promote the proven build to `stable` and increase rollout gradually.

## Emergency controls

- **Pause:** stops selection of a release without deleting immutable artifacts.
- **Withdraw:** removes a bad release from future update checks.
- **Rollout:** reduce to `0` while investigating a suspect release.
- **Desktop rollback:** the helper restores `previous/` automatically when the new process fails the post-start health contract.
- **Server rollback:** deploy the previous known-good Update Hub code commit; do not rewrite or replace already published immutable package paths.
- **Database recovery:** restore the most recent verified pre-migration backup into a recovery database first; do not overwrite production metadata until the restore has been validated.

Never delete or overwrite a published artifact to “fix” a release. Publish a new version instead.

## Verification checklist

```bash
cd /home/lightworld/update-hub/app/apps/update-hub
pnpm test
pnpm test:release
pnpm test:admin
pnpm test:signing
pnpm test:delta
pnpm test:deployment
pnpm build
systemctl is-active lightworld-update-hub.service
curl -fsS http://127.0.0.1:3041/health
curl -fsS https://updates.lightworldtech.com/health
```

Also verify:

- unauthenticated `/api/v1/admin/...` mutation returns `401`;
- signed manifest and detached signature are reachable over HTTPS;
- full package and delta SHA-256 values match their files;
- Range requests return `206` for published update packages;
- no private signing key, admin token, product key, bearer credential, or customer content appears in Git, public storage, installer contents, CI logs, or service logs.
