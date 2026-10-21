import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'lightworld-release-keygen-'));
try {
  const privateRoot = join(root, 'private');
  const publicRoot = join(root, 'public');
  mkdirSync(privateRoot, { recursive: true });
  mkdirSync(publicRoot, { recursive: true });
  const privateKeyPath = join(privateRoot, 'ipresenterplux-ed25519.pem');
  const catalogPath = join(privateRoot, 'update-public-keys.json');
  const cwd = resolve(new URL('..', import.meta.url).pathname);

  execFileSync(process.execPath, [
    'scripts/generate-release-key.mjs',
    '--private-key', resolve(privateKeyPath),
    '--catalog', resolve(catalogPath),
    '--key-id', 'lightworld-ci-2026',
    '--public-root', resolve(publicRoot)
  ], { cwd, stdio: 'pipe' });

  assert(existsSync(privateKeyPath), 'private key must be generated at the explicit restricted path');
  assert.equal(statSync(privateKeyPath).mode & 0o777, 0o600, 'private key must be mode 0600');
  const privateKey = createPrivateKey(readFileSync(privateKeyPath));
  assert.equal(privateKey.asymmetricKeyType, 'ed25519');
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  assert.equal(publicJwk.crv, 'Ed25519');
  assert.equal(typeof publicJwk.x, 'string');

  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.deepEqual(Object.keys(catalog), ['lightworld-ci-2026']);
  const rawPublicKey = Buffer.from(catalog['lightworld-ci-2026'], 'base64');
  assert.equal(rawPublicKey.length, 32, 'desktop catalog must contain the raw 32-byte Ed25519 public key');
  assert(rawPublicKey.equals(Buffer.from(publicJwk.x, 'base64url')), 'catalog public key must match the generated private key');
  assert(!readFileSync(catalogPath, 'utf8').includes('PRIVATE KEY'), 'public catalog must never contain private material');

  assert.throws(() => execFileSync(process.execPath, [
    'scripts/generate-release-key.mjs',
    '--private-key', resolve(join(publicRoot, 'forbidden.pem')),
    '--catalog', resolve(catalogPath),
    '--key-id', 'forbidden',
    '--public-root', resolve(publicRoot)
  ], { cwd, stdio: 'pipe' }), /Command failed/, 'generator must refuse a private key inside public storage');

  assert.throws(() => execFileSync(process.execPath, [
    'scripts/generate-release-key.mjs',
    '--private-key', resolve(privateKeyPath),
    '--catalog', resolve(catalogPath),
    '--key-id', 'lightworld-ci-2026',
    '--public-root', resolve(publicRoot)
  ], { cwd, stdio: 'pipe' }), /Command failed/, 'generator must never overwrite an existing private signing key');

  console.log('update-hub release key generator selftest: PASS');
} finally {
  rmSync(root, { recursive: true, force: true });
}
