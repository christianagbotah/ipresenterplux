import { sign, verify, type KeyObject } from 'node:crypto';

export type DetachedManifestSignature = {
  schemaVersion: 1;
  keyId: string;
  algorithm: 'Ed25519';
  signature: string;
};

export function signManifest(bytes: Uint8Array, privateKey: KeyObject, keyId: string): DetachedManifestSignature {
  if (!keyId.trim()) throw new Error('A signing key id is required.');
  const signature = sign(null, bytes, privateKey).toString('base64');
  return { schemaVersion: 1, keyId: keyId.trim(), algorithm: 'Ed25519', signature };
}

export function verifyManifest(
  bytes: Uint8Array,
  detached: DetachedManifestSignature,
  publicKeys: ReadonlyMap<string, KeyObject>
): boolean {
  if (detached.schemaVersion !== 1 || detached.algorithm !== 'Ed25519') return false;
  const publicKey = publicKeys.get(detached.keyId);
  if (!publicKey) return false;
  try {
    return verify(null, bytes, publicKey, Buffer.from(detached.signature, 'base64'));
  } catch {
    return false;
  }
}
