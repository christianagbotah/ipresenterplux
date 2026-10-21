import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(new URL('../../..', import.meta.url).pathname);
const read = (path) => readFileSync(resolve(repo, path), 'utf8');

const bootstrap = read('ops/update-hub/bootstrap-vps.sh');
const deploy = read('ops/update-hub/deploy.sh');
const service = read('deploy/systemd/lightworld-update-hub.service');
const nginx = read('deploy/nginx/updates.lightworldtech.com.conf');
const runbook = read('docs/runbooks/update-hub.md');

assert.match(bootstrap, /0750/, 'bootstrap must keep update directories non-world-readable');
assert.doesNotMatch(bootstrap, /chmod\s+(?:-R\s+)?0?755\s+\/home\/lightworld(?:\s|$)/, 'bootstrap must not make the Lightworld home tree world-readable');
assert.match(service, /User=lightworld/, 'Update Hub service must not run as root');
assert.match(service, /NoNewPrivileges=true/, 'systemd unit must enable NoNewPrivileges');
assert.match(service, /ReadOnlyPaths=\/home\/lightworld\/update-hub\/public/, 'service must have read-only access to public release storage');
assert.match(nginx, /location \^~ \/api\//, 'Nginx must proxy the API');
assert.match(nginx, /Cache-Control "no-store"/, 'API and health responses must be no-store');
assert.match(nginx, /max-age=31536000, immutable/, 'release trees must be immutable-cacheable');
assert.match(nginx, /Accept-Ranges bytes/, 'release downloads must advertise byte ranges');
assert.doesNotMatch(nginx, /location\s+=\s+\/\s*\{/, 'Webuzo custom include must not redefine the root location owned by the generated vhost');

for (const required of [
  'pnpm install --frozen-lockfile',
  'pnpm build',
  '001_update_hub.sql',
  'systemctl daemon-reload',
  'systemctl enable lightworld-update-hub',
  'systemctl restart lightworld-update-hub',
  '127.0.0.1:3041/health'
]) {
  assert(deploy.includes(required), `deploy script must include: ${required}`);
}
assert(/(?:nginx\s+-t|NGINX_BIN[^\n]*-t)/.test(deploy), 'deploy script must validate the configured Nginx binary with -t');
assert.match(deploy, /\$NGINX_BIN"\s+-s\s+reload/, 'Webuzo deployment must reload through the configured Nginx binary');
assert.doesNotMatch(deploy, /systemctl\s+reload\s+nginx/, 'Webuzo nginx unit does not support systemctl reload');
assert.match(deploy, /UPDATE_HUB_DRY_RUN/, 'deploy script must support dry-run');
assert.match(deploy, /runuser\s+-u\s+"?\$APP_USER"?\s+--/, 'package install/build must be able to run as the unprivileged service account');
assert.doesNotMatch(deploy, /\(cd\s+"\$APP_DIR"\s+&&\s+"\$PNPM_BIN"\s+(?:install|build)/, 'pnpm install/build must not run directly as root');
assert.doesNotMatch(deploy, /rm\s+-rf\s+\/home\/lightworld\/update-hub\/public/, 'deploy must never delete public release storage');

for (const phrase of [
  'Unknown publisher',
  'UPDATE_HUB_ADMIN_TOKEN',
  '0600',
  'outside the public tree',
  'beta',
  'stable',
  'rollback',
  '206 Partial Content',
  'Cloudflare',
  'backup',
  'private signing key'
]) {
  assert(runbook.toLowerCase().includes(phrase.toLowerCase()), `runbook must document: ${phrase}`);
}
assert(!runbook.includes('BEGIN PRIVATE KEY'), 'runbook must not contain a private key');

console.log('update-hub deployment selftest: PASS');
