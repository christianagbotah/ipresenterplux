import assert from 'node:assert/strict';
import { once } from 'node:events';
import { verifyAdminBearer } from '../src/admin-auth.ts';
import { AdminReleaseService } from '../src/routes/admin-releases.ts';
import { createUpdateHubServer } from '../src/server.ts';

const token = 'test-admin-token-keep-private';
assert.equal(verifyAdminBearer(undefined, token), false, 'missing authorization must be rejected');
assert.equal(verifyAdminBearer('Bearer wrong', token), false, 'invalid bearer token must be rejected');
assert.equal(verifyAdminBearer(`Bearer ${token}`, token), true, 'valid bearer token must be accepted');
assert.equal(verifyAdminBearer(`bearer ${token}`, token), false, 'authorization scheme is exact');

class MemoryRepository {
  releases = new Map();
  artifacts = new Map();
  events = [];
  nextId = 1;

  async createRelease(input, actor) {
    const id = String(this.nextId++);
    const release = { id, ...input, state: 'draft', rollout: input.rollout ?? 100 };
    this.releases.set(id, release);
    this.events.push({ actor, action: 'release.created', releaseId: id, detail: { version: input.version } });
    return release;
  }

  async registerArtifact(releaseId, artifact, actor) {
    if (this.artifacts.has(artifact.publicPath)) throw new Error('artifact_path_conflict');
    this.artifacts.set(artifact.publicPath, { releaseId, ...artifact });
    this.events.push({ actor, action: 'artifact.registered', releaseId, detail: { artifactType: artifact.artifactType } });
  }

  async mutateRelease(releaseId, mutation, actor) {
    const release = this.releases.get(releaseId);
    if (!release) throw new Error('release_not_found');
    Object.assign(release, mutation.patch);
    this.events.push({ actor, action: mutation.action, releaseId, detail: mutation.detail ?? {} });
    return release;
  }
}

const repository = new MemoryRepository();
const service = new AdminReleaseService(repository);
const actor = 'ci-admin';
const created = await service.create({
  product: 'ipresenterplux',
  version: '1.2.3',
  channel: 'beta',
  platform: 'windows',
  architecture: 'x64',
  minimumVersion: null,
  releaseNotes: 'UAT release',
  manifestPath: 'manifests/ipresenterplux/1.2.3.json',
  signaturePath: 'manifests/ipresenterplux/1.2.3.sig',
  rollout: 25
}, actor);
assert.equal(created.state, 'draft');

assert.throws(() => service.create({
  product: 'ipresenterplux', version: '1.2.4', channel: 'beta', platform: 'windows', architecture: 'x64',
  minimumVersion: null, releaseNotes: '', manifestPath: 'https://evil.example/release.json',
  signaturePath: 'manifests/ipresenterplux/1.2.4.sig', rollout: 10
}, actor), /manifest_path_invalid/, 'manifest path must stay same-origin relative');

await service.registerArtifact(created.id, {
  artifactType: 'full',
  sourceVersion: null,
  publicPath: 'releases/ipresenterplux/windows/x64/1.2.3/app.zip',
  sizeBytes: 123,
  sha256: 'a'.repeat(64)
}, actor);
assert.throws(() => service.registerArtifact(created.id, {
  artifactType: 'delta',
  sourceVersion: '1.2.2',
  publicPath: 'https://evil.example/delta.zip',
  sizeBytes: 42,
  sha256: 'b'.repeat(64)
}, actor), /public_path_invalid/, 'artifact path must stay same-origin relative');
await assert.rejects(
  () => service.registerArtifact(created.id, {
    artifactType: 'full',
    sourceVersion: null,
    publicPath: 'releases/ipresenterplux/windows/x64/1.2.3/app.zip',
    sizeBytes: 123,
    sha256: 'a'.repeat(64)
  }, actor),
  /artifact_path_conflict/,
  'artifact public paths must be immutable'
);

let published = await service.publish(created.id, 25, actor);
assert.equal(published.state, 'published');
assert.equal(published.rollout, 25);
published = await service.setRollout(created.id, 67, actor);
assert.equal(published.rollout, 67);
const paused = await service.pause(created.id, actor);
assert.equal(paused.state, 'paused');
const withdrawn = await service.withdraw(created.id, actor);
assert.equal(withdrawn.state, 'withdrawn');
assert.throws(() => service.setRollout(created.id, 101, actor), /rollout/i);

const rollbackTarget = await service.create({
  product: 'ipresenterplux', version: '1.2.2', channel: 'stable', platform: 'windows', architecture: 'x64',
  minimumVersion: null, releaseNotes: '', manifestPath: 'm/122.json', signaturePath: 'm/122.sig', rollout: 100
}, actor);
const withRollback = await service.setRollbackTarget(created.id, rollbackTarget.id, actor);
assert.equal(withRollback.rollbackReleaseId, rollbackTarget.id);

assert(repository.events.length >= 7, 'every admin mutation must append an audit event');
assert(repository.events.every((event) => event.actor === actor && event.action && event.releaseId), 'audit events must include actor/action/release id');
const auditJson = JSON.stringify(repository.events);
assert(!auditJson.includes(token), 'admin token must never enter audit detail');
assert(!auditJson.toLowerCase().includes('privatekey'), 'private signing key material must never enter audit detail');

const httpRepository = new MemoryRepository();
const server = createUpdateHubServer({
  config: {
    publicOrigin: new URL('https://updates.example.test'),
    databaseUrl: 'postgres://unused',
    publicRoot: '/tmp/lightworld-update-hub-test',
    host: '127.0.0.1',
    port: 0
  },
  releaseRepository: { listForProduct: async () => [] },
  adminRepository: httpRepository,
  adminToken: token
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
try {
  const body = {
    product: 'ipresenterplux', version: '2.0.0', channel: 'beta', platform: 'windows', architecture: 'x64',
    minimumVersion: null, releaseNotes: 'HTTP UAT', manifestPath: 'manifests/ipresenterplux/2.0.0.json',
    signaturePath: 'manifests/ipresenterplux/2.0.0.sig', rollout: 10
  };
  const unauthorized = await fetch(`${base}/api/v1/admin/releases`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal(unauthorized.status, 401, 'admin API must reject missing bearer token');

  const authorized = await fetch(`${base}/api/v1/admin/releases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-update-hub-actor': 'release-operator'
    },
    body: JSON.stringify(body)
  });
  assert.equal(authorized.status, 201, 'authorized release creation must succeed');
  const authorizedBody = await authorized.json();
  assert.equal(authorizedBody.state, 'draft');
  assert.equal(httpRepository.events.at(-1)?.actor, 'release-operator');

  const malformed = await fetch(`${base}/api/v1/admin/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: '{not-json'
  });
  assert.equal(malformed.status, 400, 'malformed admin JSON must be rejected without crashing the server');
} finally {
  server.close();
  await once(server, 'close');
}

console.log('update-hub admin selftest: PASS');