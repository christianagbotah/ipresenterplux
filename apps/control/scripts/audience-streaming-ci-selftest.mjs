#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const workflow = readFileSync(path.join(root, ".github/workflows/control-ci.yml"), "utf8");
const safety = readFileSync(path.join(root, "apps/control/scripts/db-selftest-safety-selftest.mjs"), "utf8");

for (const script of [
  "test:stream-session-authority",
  "test:service-stream-lifecycle",
  "test:audience-studio",
  "test:audience-live-state",
  "test:streaming-studio-recovery"
]) {
  assert.match(workflow, new RegExp(`pnpm ${script.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`, "u"), `Control Portal CI must run ${script}`);
}

for (const script of ["service-stream-lifecycle-selftest.mjs", "audience-live-state-selftest.mjs"]) {
  assert.match(safety, new RegExp(script.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "u"), `${script} must be protected by the writable DB safety meta-test`);
}

console.log(JSON.stringify({ ok: true, audienceStreamingCi: true, writableGuards: 2 }));
