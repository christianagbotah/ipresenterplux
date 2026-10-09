#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Cockpit field UAT requires an isolated PostgreSQL DATABASE_URL");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);

const controlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = [
  { id: 1, name: "healthy service enters Focus Mode", tests: ["test:cockpit-view-model", "test:cockpit-focus"] },
  { id: 2, name: "Scripture detected, recommended, previewed and operator-safe", tests: ["test:scripture-quote", "test:cockpit-predictive-next", "test:operator-workspace"] },
  { id: 3, name: "wrong recommendation dismissed without disturbing Program", tests: ["test:cockpit-recommendations"] },
  { id: 4, name: "song/media search and preparation stays in live mental model", tests: ["test:media-workspace", "test:cockpit-command"] },
  { id: 5, name: "social stream failure is contained and explained", tests: ["test:cockpit-attention", "test:stream-provider-health"] },
  { id: 6, name: "translation/TTS degradation preserves original-language path", tests: ["test:cockpit-attention", "test:transcript-window"] },
  { id: 7, name: "stale camera truth suppresses unsafe recommendation", tests: ["test:camera-workspace", "test:cockpit-predictive-next"] },
  { id: 8, name: "typed command resolves safe search/preparation intent", tests: ["test:cockpit-command"] },
  { id: 9, name: "unauthorized advanced-depth user never gains live authority", tests: ["test:rbac-ui", "test:cockpit-focus", "test:cockpit-role-projection"] },
  { id: 10, name: "ended service remains available as structured Archive memory", tests: ["test:archive"] }
];

const orderedTests = [...new Set(scenarios.flatMap((scenario) => scenario.tests))];
const envFile = path.join(controlRoot, ".env.local");
const createdEnvFile = !existsSync(envFile);
if (createdEnvFile) writeFileSync(envFile, `DATABASE_URL=${databaseUrl}\n`, { encoding: "utf8", mode: 0o600 });
const results = new Map();
try {
for (const testName of orderedTests) {
  const run = spawnSync("pnpm", [testName], {
    cwd: controlRoot,
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (run.status !== 0) {
    process.stderr.write(`\nField UAT dependency failed: ${testName}\n`);
    if (run.stdout) process.stderr.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    process.exit(run.status ?? 1);
  }
  results.set(testName, true);
}
} finally {
  if (createdEnvFile) unlinkSync(envFile);
}

const passed = scenarios.map((scenario) => ({
  id: scenario.id,
  name: scenario.name,
  ok: scenario.tests.every((testName) => results.get(testName) === true),
  tests: scenario.tests
}));
assert.equal(passed.length, 10);
assert.ok(passed.every((scenario) => scenario.ok));

console.log(JSON.stringify({
  ok: true,
  scenarios: passed.map(({ id, name }) => ({ id, name })),
  uniqueBehaviorGates: orderedTests.length,
  programAuthority: "existing_domain_paths_only",
  productionDatabaseBlocked: true
}));
