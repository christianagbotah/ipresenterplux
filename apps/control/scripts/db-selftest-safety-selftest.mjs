#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const allowed = [
  "postgresql://tester:secret@127.0.0.1:5432/ipresenterplux_ci",
  "postgres://tester:secret@localhost:5432/ipresenterplux_test",
  "postgres://tester:secret@db.example.test:5432/ipresenterplux-selftest",
  "postgres://tester:secret@db.example.test:5432/test"
];
for (const databaseUrl of allowed) {
  assert.doesNotThrow(() => assertWritableSelfTestDatabase(databaseUrl, {}));
}

for (const databaseUrl of [
  "postgresql://tester:secret@127.0.0.1:5432/lightworld_iplux",
  "postgresql://tester:secret@127.0.0.1:5432/ipresenterplux",
  "postgresql://tester:secret@127.0.0.1:5432/contest"
]) {
  assert.throws(
    () => assertWritableSelfTestDatabase(databaseUrl, {}),
    /database_selftest_refused_non_test_database/
  );
}

assert.throws(
  () => assertWritableSelfTestDatabase(undefined, {}),
  /DATABASE_URL must be configured/
);
assert.throws(
  () => assertWritableSelfTestDatabase("not-a-database-url", {}),
  /DATABASE_URL is invalid/
);
assert.doesNotThrow(() =>
  assertWritableSelfTestDatabase(
    "postgresql://tester:secret@127.0.0.1:5432/lightworld_iplux",
    { IPRESENTERPLUX_ALLOW_DATABASE_SELFTEST: "I_UNDERSTAND_THIS_CAN_WRITE_DATA" }
  )
);

const protectedScripts = [
  "activation-api-selftest.mjs",
  "audience-live-state-selftest.mjs",
  "edge-operator-catalog-selftest.mjs",
  "licensing-admin-selftest.mjs",
  "service-planner-item-selftest.mjs",
  "service-planner-mutation-selftest.mjs",
  "service-planner-readiness-selftest.mjs",
  "service-planner-service-selftest.mjs",
  "service-stream-lifecycle-selftest.mjs",
  "speaker-attribution-selftest.mjs",
  "speech-synthesis-selftest.mjs",
  "stream-contribution-selftest.mjs",
  "stream-fanout-selftest.mjs",
  "stream-provider-health-selftest.mjs",
  "stream-session-authority-selftest.mjs",
  "subscription-schema-selftest.mjs",
  "transcript-window-selftest.mjs",
  "translation-worker-selftest.mjs",
  "tts-worker-selftest.mjs",
  "voice-binding-selftest.mjs",
  "voice-consent-selftest.mjs"
];

for (const script of protectedScripts) {
  const source = await fs.readFile(path.join(here, script), "utf8");
  assert.match(source, /from "\.\/selftest-db-safety\.mjs"/u, `${script} must import the DB safety guard`);
  assert.match(source, /assertWritableSelfTestDatabase\(process\.env\.DATABASE_URL/u, `${script} must invoke the DB safety guard`);
}

console.log(JSON.stringify({
  ok: true,
  productionDatabaseBlocked: true,
  explicitOverrideSupported: true,
  protectedWritableSelfTests: protectedScripts.length
}));
