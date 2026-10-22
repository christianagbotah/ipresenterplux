#!/usr/bin/env node
import { signManifestFile } from '../src/release-publisher.ts';

function argumentsMap(values) {
  const map = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('invalid_arguments');
    map.set(key.slice(2), value);
  }
  return map;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'sign') throw new Error('unsupported_command');
  const args = argumentsMap(rest);
  const required = (name) => {
    const value = args.get(name);
    if (!value) throw new Error(`missing_${name}`);
    return value;
  };

  const detached = await signManifestFile({
    manifestPath: required('manifest'),
    privateKeyPath: required('private-key'),
    keyId: required('key-id'),
    signaturePath: required('signature'),
    publicRoot: required('public-root')
  });
  process.stdout.write(`Detached ${detached.algorithm} signature created for key ${detached.keyId}.\n`);
}

main().catch(() => {
  process.stderr.write('Release signing failed.\n');
  process.exitCode = 1;
});
