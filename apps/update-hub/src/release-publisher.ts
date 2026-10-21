import { createPrivateKey } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { canonicalManifestBytes, type ReleaseManifestV1 } from './manifest.js';
import { signManifest, type DetachedManifestSignature } from './signing.js';

export type SignManifestFileOptions = {
  manifestPath: string;
  privateKeyPath: string;
  signaturePath: string;
  publicRoot: string;
  keyId: string;
};

function assertAbsolutePath(value: string, label: string): string {
  if (!value?.trim() || !isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return resolve(value);
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export async function signManifestFile(options: SignManifestFileOptions): Promise<DetachedManifestSignature> {
  const publicRoot = assertAbsolutePath(options.publicRoot, 'Public root');
  const manifestPath = assertAbsolutePath(options.manifestPath, 'Manifest path');
  const privateKeyPath = assertAbsolutePath(options.privateKeyPath, 'Private key path');
  const signaturePath = assertAbsolutePath(options.signaturePath, 'Signature path');
  const keyId = options.keyId?.trim();
  if (!keyId || keyId.length > 80 || !/^[A-Za-z0-9._-]+$/.test(keyId))
    throw new Error('Signing key id is invalid.');
  if (isInside(publicRoot, privateKeyPath))
    throw new Error('The release signing private key must remain outside the public release tree.');
  if (!isInside(publicRoot, manifestPath) || !isInside(publicRoot, signaturePath))
    throw new Error('Manifest and detached signature must be inside the public release tree.');

  const [manifestJson, privatePem] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(privateKeyPath, 'utf8')
  ]);
  let manifest: ReleaseManifestV1;
  try {
    manifest = JSON.parse(manifestJson) as ReleaseManifestV1;
  } catch {
    throw new Error('Release manifest is not valid JSON.');
  }
  const privateKey = createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release signing key must be Ed25519.');
  const detached = signManifest(canonicalManifestBytes(manifest), privateKey, keyId);
  const temporary = `${signaturePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(detached)}\n`, { encoding: 'utf8', mode: 0o644 });
    await rename(temporary, signaturePath);
  } catch (error) {
    try { await import('node:fs/promises').then(({ unlink }) => unlink(temporary)); } catch { }
    throw error;
  }
  return detached;
}
