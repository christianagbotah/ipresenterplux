import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

const model = await import('../src/release-model.ts');
const manifest = await import('../src/manifest.ts');
const signing = await import('../src/signing.ts');

const releases = [
  { id: 1, product: 'ipresenterplux', version: '1.1.0', channel: 'stable', platform: 'windows', architecture: 'x64', state: 'published', rollout: 100, publishedAt: '2026-10-20T00:00:00Z' },
  { id: 2, product: 'ipresenterplux', version: '1.2.0', channel: 'beta', platform: 'windows', architecture: 'x64', state: 'published', rollout: 100, publishedAt: '2026-10-21T00:00:00Z' },
  { id: 3, product: 'ipresenterplux', version: '1.3.0', channel: 'stable', platform: 'windows', architecture: 'arm64', state: 'published', rollout: 100, publishedAt: '2026-10-21T00:00:00Z' },
  { id: 4, product: 'ipresenterplux', version: '1.4.0', channel: 'stable', platform: 'windows', architecture: 'x64', state: 'paused', rollout: 100, publishedAt: '2026-10-21T00:00:00Z' },
  { id: 5, product: 'ipresenterplux', version: '1.5.0', channel: 'stable', platform: 'windows', architecture: 'x64', state: 'withdrawn', rollout: 100, publishedAt: '2026-10-21T00:00:00Z' }
];

assert.equal(model.selectRelease(releases, { product: 'ipresenterplux', version: '1.0.0', channel: 'stable', platform: 'windows', architecture: 'x64', installationId: 'church-a' })?.version, '1.1.0');
assert.equal(model.selectRelease(releases, { product: 'ipresenterplux', version: '1.1.0', channel: 'stable', platform: 'windows', architecture: 'x64', installationId: 'church-a' }), null);
assert.equal(model.selectRelease(releases, { product: 'ipresenterplux', version: '1.0.0', channel: 'beta', platform: 'windows', architecture: 'x64', installationId: 'church-a' })?.version, '1.2.0');
assert.equal(model.selectRelease(releases, { product: 'ipresenterplux', version: '1.0.0', channel: 'stable', platform: 'linux', architecture: 'x64', installationId: 'church-a' }), null);

const bucketA = model.rolloutBucket('install-123', '99');
const bucketB = model.rolloutBucket('install-123', '99');
assert.equal(bucketA, bucketB);
assert.ok(bucketA >= 0 && bucketA <= 99);
const staged = [{ ...releases[0], id: 99, version: '2.0.0', rollout: bucketA }];
assert.equal(model.selectRelease(staged, { product: 'ipresenterplux', version: '1.0.0', channel: 'stable', platform: 'windows', architecture: 'x64', installationId: 'install-123' }), null, 'bucket equal to rollout must be excluded because rollout is a percentage count');

const input = {
  schemaVersion: 1,
  product: 'ipresenterplux',
  version: '1.1.0',
  channel: 'stable',
  platform: 'windows',
  architecture: 'x64',
  minimumVersion: '1.0.0',
  publishedAt: '2026-10-21T00:00:00Z',
  releaseNotes: 'Safe update',
  fullPackage: { url: 'https://updates.lightworldtech.com/releases/ipresenterplux/windows/x64/1.1.0/app.zip', size: 1234, sha256: 'a'.repeat(64) },
  deltaPackages: [],
  rollout: 100
};
const bytes1 = manifest.canonicalManifestBytes(input);
const bytes2 = manifest.canonicalManifestBytes({ ...input, fullPackage: { sha256: 'a'.repeat(64), size: 1234, url: input.fullPackage.url } });
assert.equal(bytes1.toString('utf8'), bytes2.toString('utf8'), 'canonicalization must ignore object insertion order');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const detached = signing.signManifest(bytes1, privateKey, 'lightworld-uat-1');
assert.equal(detached.algorithm, 'Ed25519');
assert.equal(detached.keyId, 'lightworld-uat-1');
assert.equal(signing.verifyManifest(bytes1, detached, new Map([['lightworld-uat-1', publicKey]])), true);
const tampered = Buffer.from(bytes1);
tampered[tampered.length - 2] ^= 1;
assert.equal(signing.verifyManifest(tampered, detached, new Map([['lightworld-uat-1', publicKey]])), false);
assert.equal(signing.verifyManifest(bytes1, { ...detached, keyId: 'unknown' }, new Map([['lightworld-uat-1', publicKey]])), false);

console.log('update-hub release selftest: PASS');
