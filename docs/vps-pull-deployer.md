# VPS pull deployer

The Control Plane is deployed from GitHub `main` by a VPS-side one-minute poller. GitHub never SSHs into the server and does not require a deployment private key.

## Release flow

1. A commit is merged to `main` after normal CI is green.
2. `.github/workflows/deploy.yml` validates the deployment contract and records a handoff summary. The workflow is a handoff only; it does not claim that the VPS has deployed the commit.
3. `ipresenterplux-deploy.timer` triggers `ipresenterplux-deploy.service` every minute.
4. The deployer refuses a dirty production checkout and fetches only `origin/main`.
5. The current deployed SHA must be an ancestor of `origin/main`; divergent/non-fast-forward history is rejected.
6. A temporary candidate release is archived from the target SHA. The deployer links the existing private `apps/control/.env.local`, installs dependencies and builds the Control Plane as `lightworld` while the current service remains online.
7. Database migrations run only after the candidate build succeeds.
8. The deployer stops only `ipresenterplux.service`, fast-forwards the live checkout, atomically swaps the candidate `.next` and `node_modules`, then restarts the service.
9. Both the local origin health endpoint and the public HTTPS health endpoint must return the iPresenterPlux healthy payload.
10. On swap, restart or health failure, tracked code and the previous build/dependency directories are restored to the prior SHA and the prior Control Plane is restarted.

Desktop/Edge, mobile and native artifacts are never compiled by this VPS deployer.

## Safety boundaries

- Approved app path: `/home/lightworld/webapps/ipresenterplux` only.
- Runtime app user: `lightworld`.
- The deploy one-shot itself runs as root only because it must control the existing systemd service. Git, dependency installation, migration and build commands are explicitly dropped to `lightworld` with `runuser`.
- `.env.local`, `storage/`, logs, recordings/caches, `.secrets/` and certificate material are not cleaned or copied into Git.
- A single-instance `flock` prevents overlapping deployments.
- Unexpected tracked or untracked Git state fails closed.
- The live checkout is changed only after candidate install/build/migration validation succeeds.
- Rollback is a code/build rollback. Database migrations are not reversed automatically, so production migrations must remain forward/backward compatible with the immediately previous Control Plane release.
- The deploy script does not build or publish `apps/edge-agent` and does not invoke `dotnet build` or `dotnet publish`.

## Versioned files

- `.github/workflows/deploy.yml`
- `ops/deploy/ipresenterplux-deploy.sh`
- `ops/deploy/ipresenterplux-deploy.service`
- `ops/deploy/ipresenterplux-deploy.timer`
- `ops/deploy/ipresenterplux-deploy-selftest.sh`
- `apps/control/scripts/deployment-contract-selftest.mjs`

## Install or refresh the VPS poller

Run as root from a checked-out release:

```bash
install -d -m 0755 /home/lightworld/bin
install -m 0755 ops/deploy/ipresenterplux-deploy.sh /home/lightworld/bin/ipresenterplux-deploy.sh
install -m 0644 ops/deploy/ipresenterplux-deploy.service /etc/systemd/system/ipresenterplux-deploy.service
install -m 0644 ops/deploy/ipresenterplux-deploy.timer /etc/systemd/system/ipresenterplux-deploy.timer
systemctl daemon-reload
systemctl enable --now ipresenterplux-deploy.timer
```

The poller can be exercised immediately with:

```bash
systemctl start ipresenterplux-deploy.service
```

## Verification and audit

```bash
systemctl status ipresenterplux-deploy.timer --no-pager
systemctl status ipresenterplux-deploy.service --no-pager
journalctl -u ipresenterplux-deploy.service -n 100 --no-pager
cat /home/lightworld/deployments/ipresenterplux/last_successful_sha
cat /home/lightworld/deployments/ipresenterplux/last_successful_at
cat /home/lightworld/deployments/ipresenterplux/last_manifest.txt
curl -fsS http://127.0.0.1:3011/api/v1/health
curl -fsS https://ipresenterplux.lightworldtech.com/api/v1/health
```

The behavioral VPS self-test uses a temporary local Git remote and fake service/health commands. It proves both a successful fast-forward release and rollback after a forced public-health failure without touching the live app:

```bash
sudo ops/deploy/ipresenterplux-deploy-selftest.sh
```
