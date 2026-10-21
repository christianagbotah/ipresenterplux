#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

function parseArgs(values) {
  const args = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('Invalid delta builder arguments.');
    args.set(key.slice(2), value);
  }
  return args;
}

function required(args, key) {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function normalizeRelative(root, absolute) {
  const rel = relative(root, absolute).split(sep).join('/');
  if (!rel || rel === 'delta.json' || rel.startsWith('../') || isAbsolute(rel) || rel.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
    throw new Error(`Unsafe or reserved delta path: ${rel || '<empty>'}`);
  return rel;
}

function hashFile(path) {
  const content = readFileSync(path);
  return { size: content.length, sha256: createHash('sha256').update(content).digest('hex') };
}

function catalog(root) {
  const result = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported in desktop release trees: ${absolute}`);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const path = normalizeRelative(root, absolute);
        result.set(path, { path, ...hashFile(absolute), absolute });
      } else {
        throw new Error(`Unsupported release-tree entry: ${absolute}`);
      }
    }
  }
  visit(root);
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromDir = resolve(required(args, 'from-dir'));
  const toDir = resolve(required(args, 'to-dir'));
  const fromVersion = required(args, 'from-version');
  const toVersion = required(args, 'to-version');
  const output = resolve(required(args, 'output'));
  if (fromVersion === toVersion) throw new Error('Delta source and target versions must differ.');

  const before = catalog(fromDir);
  const after = catalog(toDir);
  const changed = [...after.values()]
    .filter((entry) => {
      const old = before.get(entry.path);
      return !old || old.size !== entry.size || old.sha256 !== entry.sha256;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const deletedPaths = [...before.keys()].filter((path) => !after.has(path)).sort();
  const resultCatalog = [...after.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, size, sha256 }) => ({ path, size, sha256 }));
  const files = changed.map(({ path, size, sha256 }) => ({ path, size, sha256 }));

  const staging = mkdtempSync(join(tmpdir(), 'lightworld-delta-stage-'));
  try {
    const metadata = { schemaVersion: 1, fromVersion, toVersion, files, deletedPaths, resultCatalog };
    writeFileSync(join(staging, 'delta.json'), `${JSON.stringify(metadata)}\n`, 'utf8');
    for (const entry of changed) {
      const target = join(staging, ...entry.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(entry.absolute, target);
    }

    mkdirSync(dirname(output), { recursive: true });
    try { unlinkSync(output); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const zipEntries = ['delta.json', ...changed.map((entry) => entry.path)].sort();
    execFileSync('zip', ['-X', '-q', output, ...zipEntries], { cwd: staging, stdio: 'pipe' });
    const packageStats = hashFile(output);
    process.stdout.write(`${JSON.stringify({
      output,
      fromVersion,
      toVersion,
      changedFiles: changed.length,
      deletedFiles: deletedPaths.length,
      size: packageStats.size,
      sha256: packageStats.sha256
    })}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Delta build failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
