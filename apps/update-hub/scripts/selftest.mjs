import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const { loadConfig } = await import('../src/config.ts');
const { releaseArtifactPath } = await import('../src/storage.ts');
const { createUpdateHubServer } = await import('../src/server.ts');

assert.throws(
  () => loadConfig({
    UPDATE_HUB_PUBLIC_ORIGIN: 'http://updates.example.com',
    UPDATE_HUB_DATABASE_URL: 'postgres://user:pass@127.0.0.1/db',
    UPDATE_HUB_PUBLIC_ROOT: '/tmp/update-hub-public'
  }),
  /HTTPS/i,
  'remote public origins must require HTTPS'
);

const config = loadConfig({
  UPDATE_HUB_PUBLIC_ORIGIN: 'https://updates.lightworldtech.com',
  UPDATE_HUB_DATABASE_URL: 'postgres://user:pass@127.0.0.1/db',
  UPDATE_HUB_PUBLIC_ROOT: '/tmp/update-hub-public',
  UPDATE_HUB_PORT: '0'
});
assert.equal(config.publicOrigin.href, 'https://updates.lightworldtech.com/');
assert.equal(config.host, '127.0.0.1');
assert.equal(config.port, 0);

const temp = await mkdtemp(path.join(os.tmpdir(), 'update-hub-selftest-'));
try {
  const safe = releaseArtifactPath(temp, 'ipresenterplux', 'windows', 'x64', '1.2.3', 'app.zip');
  assert.ok(safe.startsWith(path.resolve(temp) + path.sep));
  assert.ok(safe.endsWith(path.join('releases', 'ipresenterplux', 'windows', 'x64', '1.2.3', 'app.zip')));
  assert.throws(
    () => releaseArtifactPath(temp, 'ipresenterplux', 'windows', 'x64', '1.2.3', '../escape.zip'),
    /path|segment|traversal/i
  );

  const server = createUpdateHubServer({ config: { ...config, publicRoot: temp } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'lightworld-update-hub' });
  server.close();
  await once(server, 'close');
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('update-hub selftest: PASS');
