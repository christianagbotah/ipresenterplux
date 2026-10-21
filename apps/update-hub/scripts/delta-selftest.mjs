import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'lightworld-delta-builder-'));
try {
  const fromDir = join(root, 'from');
  const toDir = join(root, 'to');
  mkdirSync(fromDir, { recursive: true });
  mkdirSync(toDir, { recursive: true });
  writeFileSync(join(fromDir, 'keep.txt'), 'keep');
  writeFileSync(join(fromDir, 'change.txt'), 'old');
  writeFileSync(join(fromDir, 'delete.txt'), 'gone');
  writeFileSync(join(toDir, 'keep.txt'), 'keep');
  writeFileSync(join(toDir, 'change.txt'), 'new');
  writeFileSync(join(toDir, 'added.txt'), 'added');
  mkdirSync(join(toDir, 'nested'));
  writeFileSync(join(toDir, 'nested', 'asset.bin'), Buffer.from([1, 2, 3, 4]));
  const output = join(root, 'delta.zip');

  execFileSync(process.execPath, [
    'scripts/build-delta.mjs',
    '--from-dir', fromDir,
    '--to-dir', toDir,
    '--from-version', '1.0.0',
    '--to-version', '1.1.0',
    '--output', output
  ], { cwd: resolve(new URL('..', import.meta.url).pathname), stdio: 'pipe' });

  const names = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(names, ['added.txt', 'change.txt', 'delta.json', 'nested/asset.bin']);
  const delta = JSON.parse(execFileSync('unzip', ['-p', output, 'delta.json'], { encoding: 'utf8' }));
  assert.equal(delta.schemaVersion, 1);
  assert.equal(delta.fromVersion, '1.0.0');
  assert.equal(delta.toVersion, '1.1.0');
  assert.deepEqual(delta.deletedPaths, ['delete.txt']);
  assert.deepEqual(delta.files.map((entry) => entry.path).sort(), ['added.txt', 'change.txt', 'nested/asset.bin']);
  assert.deepEqual(delta.resultCatalog.map((entry) => entry.path).sort(), ['added.txt', 'change.txt', 'keep.txt', 'nested/asset.bin']);
  for (const entry of [...delta.files, ...delta.resultCatalog]) {
    assert(Number.isSafeInteger(entry.size) && entry.size >= 0, `missing size for ${entry.path}`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `missing SHA-256 for ${entry.path}`);
  }

  console.log('update-hub delta builder selftest: PASS');
} finally {
  rmSync(root, { recursive: true, force: true });
}
