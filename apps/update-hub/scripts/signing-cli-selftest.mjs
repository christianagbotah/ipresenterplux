import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalManifestBytes } from '../src/manifest.ts';
import { verifyManifest } from '../src/signing.ts';

const root = mkdtempSync(join(tmpdir(), 'lightworld-signing-cli-'));
try {
  const privateDir = join(root, 'private');
  const publicRoot = join(root, 'public');
  mkdirSync(privateDir, { recursive: true });
  mkdirSync(publicRoot, { recursive: true });
  const manifestPath = join(publicRoot, 'release.json');
  const signaturePath = join(publicRoot, 'release.sig');
  const privateKeyPath = join(privateDir, 'release-signing.pem');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const manifest = {
    schemaVersion: 1,
    product: 'ipresenterplux',
    version: '9.9.9',
    channel: 'beta',
    platform: 'windows',
    architecture: 'x64',
    minimumVersion: null,
    publishedAt: '2026-10-21T00:00:00.000Z',
    releaseNotes: 'Signing CLI test',
    fullPackage: { url: 'https://updates.example.test/app.zip', size: 42, sha256: 'a'.repeat(64) },
    deltaPackages: [],
    rollout: 100
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));

  execFileSync(process.execPath, [
    '--import', 'tsx', 'scripts/release-cli.mjs', 'sign',
    '--manifest', resolve(manifestPath),
    '--private-key', resolve(privateKeyPath),
    '--key-id', 'lightworld-ci-test',
    '--signature', resolve(signaturePath),
    '--public-root', resolve(publicRoot)
  ], { cwd: resolve(new URL('..', import.meta.url).pathname), stdio: 'pipe' });

  const detachedText = readFileSync(signaturePath, 'utf8');
  const detached = JSON.parse(detachedText);
  assert.equal(detached.keyId, 'lightworld-ci-test');
  assert.equal(detached.algorithm, 'Ed25519');
  assert(!detachedText.includes('PRIVATE KEY'), 'signature output must never contain private key material');
  const publicKeys = new Map([['lightworld-ci-test', publicKey]]);
  assert(verifyManifest(canonicalManifestBytes(manifest), detached, publicKeys), 'CLI detached signature must verify');

  const publicPrivateKey = join(publicRoot, 'bad-private.pem');
  writeFileSync(publicPrivateKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => execFileSync(process.execPath, [
    '--import', 'tsx', 'scripts/release-cli.mjs', 'sign',
    '--manifest', resolve(manifestPath),
    '--private-key', resolve(publicPrivateKey),
    '--key-id', 'bad',
    '--signature', resolve(signaturePath),
    '--public-root', resolve(publicRoot)
  ], { cwd: resolve(new URL('..', import.meta.url).pathname), stdio: 'pipe' }), /Command failed/,
  'signer must refuse a private key located inside the public release tree');

  console.log('update-hub signing CLI selftest: PASS');
} finally {
  rmSync(root, { recursive: true, force: true });
}
