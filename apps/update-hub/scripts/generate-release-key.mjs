import { generateKeyPairSync } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

function usage() {
  console.error('Usage: node scripts/generate-release-key.mjs --private-key <absolute-pem-path> --catalog <absolute-json-path> --key-id <id> --public-root <absolute-public-root>');
  process.exit(2);
}

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) usage();
    result.set(name, value);
  }
  return result;
}

function absolute(value, label) {
  if (!value || !isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return resolve(value);
}

function isInside(root, candidate) {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

const args = parseArgs(process.argv.slice(2));
const privateKeyPath = absolute(args.get('--private-key'), 'Private key path');
const catalogPath = absolute(args.get('--catalog'), 'Public catalog path');
const publicRoot = absolute(args.get('--public-root'), 'Public root');
const keyId = args.get('--key-id')?.trim();
if (!keyId || keyId.length > 80 || !/^[A-Za-z0-9._-]+$/.test(keyId)) throw new Error('Signing key id is invalid.');
if (isInside(publicRoot, privateKeyPath))
  throw new Error('The release signing private key must remain outside the public release tree.');
if (privateKeyPath === catalogPath) throw new Error('Private key and public catalog paths must be different.');

await mkdir(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
await mkdir(dirname(catalogPath), { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
if (publicJwk.crv !== 'Ed25519' || typeof publicJwk.x !== 'string')
  throw new Error('Generated public key is not Ed25519.');
const rawPublicKey = Buffer.from(publicJwk.x, 'base64url');
if (rawPublicKey.length !== 32) throw new Error('Generated Ed25519 public key has an unexpected length.');
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
const catalogJson = `${JSON.stringify({ [keyId]: rawPublicKey.toString('base64') }, null, 2)}\n`;

let privateHandle;
let catalogHandle;
try {
  privateHandle = await open(privateKeyPath, 'wx', 0o600);
  try {
    catalogHandle = await open(catalogPath, 'wx', 0o644);
  } catch (error) {
    await privateHandle.close();
    privateHandle = undefined;
    try { await unlink(privateKeyPath); } catch { }
    throw error;
  }

  await privateHandle.writeFile(privatePem, { encoding: 'utf8' });
  await privateHandle.sync();
  await privateHandle.chmod(0o600);
  await catalogHandle.writeFile(catalogJson, { encoding: 'utf8' });
  await catalogHandle.sync();
} finally {
  if (privateHandle) await privateHandle.close();
  if (catalogHandle) await catalogHandle.close();
}

console.log(`Release signing key generated. Key id: ${keyId}`);
console.log(`Private key: ${privateKeyPath}`);
console.log(`Public desktop catalog: ${catalogPath}`);
