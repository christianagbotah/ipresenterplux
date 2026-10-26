#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let evaluator;
try {
  ({ evaluateAutoScriptureLiveFieldUat: evaluator } = await import("../src/lib/scripture-auto-live-field-uat.ts"));
} catch {
  assert.fail("Auto Scripture Live field-UAT evaluator must exist");
}
assert.equal(typeof evaluator, "function", "field-UAT evaluator must export evaluateAutoScriptureLiveFieldUat");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(scriptDir, "scripture-auto-live-field-uat-gate.mjs");
assert.ok(existsSync(cliPath), "field-UAT CLI gate must exist");

function caseRow(index, overrides = {}) {
  const finalized = new Date(Date.UTC(2099, 0, 1, 10, 0, index * 2));
  const queued = new Date(finalized.getTime() + 900 + (index % 5) * 50);
  return {
    id: `case-${index + 1}`,
    category: "explicit_reference",
    reference: `John 3:${16 + (index % 2)}`,
    expectedProgram: "live",
    actualProgram: "live",
    recognitionFinalizedAt: finalized.toISOString(),
    programCommandQueuedAt: queued.toISOString(),
    ...overrides
  };
}

const requiredSafety = [
  caseRow(50, { id: "repeat", category: "repeated_reference", expectedProgram: "not_live", actualProgram: "not_live", programCommandQueuedAt: null }),
  caseRow(51, { id: "competing", category: "competing_references", expectedProgram: "not_live", actualProgram: "not_live", programCommandQueuedAt: null }),
  caseRow(52, { id: "low-asr", category: "low_asr_confidence", expectedProgram: "not_live", actualProgram: "not_live", programCommandQueuedAt: null }),
  caseRow(53, { id: "edge-down", category: "edge_disconnect", expectedProgram: "not_live", actualProgram: "not_live", programCommandQueuedAt: null }),
  caseRow(54, { id: "ended", category: "service_end", expectedProgram: "not_live", actualProgram: "not_live", programCommandQueuedAt: null }),
  caseRow(55, { id: "disarm", category: "emergency_disarm", expectedProgram: "not_live", actualProgram: "not_live", programCommandQueuedAt: null }),
  caseRow(56, { id: "quote", category: "quote_mode", expectedProgram: "live", actualProgram: "live" })
];

const good = evaluator({
  hardware: { platform: "windows", edgeVersion: "uat", microphone: "field-mic" },
  cases: [...Array.from({ length: 50 }, (_, index) => caseRow(index)), ...requiredSafety]
});
assert.equal(good.releaseReady, true);
assert.equal(good.explicitReferenceCases, 50);
assert.equal(good.unsafeProgramBypasses, 0);
assert.equal(good.falseTakeRate, 0);
assert.equal(good.missedEligibleRate, 0);
assert.ok(good.latency.p95Ms <= 1500);
assert.deepEqual(good.missingCategories, []);

const unsafe = evaluator({
  hardware: { platform: "windows", edgeVersion: "uat", microphone: "field-mic" },
  cases: [...Array.from({ length: 50 }, (_, index) => caseRow(index)), ...requiredSafety.map((row) => row.id === "competing" ? { ...row, actualProgram: "live", programCommandQueuedAt: new Date(new Date(row.recognitionFinalizedAt).getTime() + 700).toISOString() } : row)]
});
assert.equal(unsafe.releaseReady, false);
assert.equal(unsafe.unsafeProgramBypasses, 1);
assert.ok(unsafe.falseTakeRate > 0);
assert.ok(unsafe.blockers.includes("unsafe_program_bypass"));

const slowCases = Array.from({ length: 50 }, (_, index) => caseRow(index, {
  programCommandQueuedAt: new Date(new Date(caseRow(index).recognitionFinalizedAt).getTime() + (index < 46 ? 900 : 1900)).toISOString()
}));
const slow = evaluator({ hardware: { platform: "windows", edgeVersion: "uat", microphone: "field-mic" }, cases: [...slowCases, ...requiredSafety] });
assert.equal(slow.releaseReady, false);
assert.ok(slow.latency.p95Ms > 1500);
assert.ok(slow.blockers.includes("p95_latency_above_1500ms"));

const short = evaluator({ hardware: { platform: "windows", edgeVersion: "uat", microphone: "field-mic" }, cases: [...Array.from({ length: 49 }, (_, index) => caseRow(index)), ...requiredSafety] });
assert.equal(short.releaseReady, false);
assert.ok(short.blockers.includes("explicit_reference_cases_below_50"));

const temp = mkdtempSync(path.join(tmpdir(), "ipresenterplux-auto-live-uat-"));
const templatePath = path.join(temp, "template.json");
const initCli = spawnSync(process.execPath, [cliPath, "--init", templatePath], { encoding: "utf8" });
assert.equal(initCli.status, 0, initCli.stderr || initCli.stdout);
assert.ok(existsSync(templatePath), "--init must create a field-UAT report template");
const template = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(templatePath, "utf8")));
assert.equal(template.cases.filter((row) => row.category === "explicit_reference").length, 50);
for (const row of requiredSafety) assert.ok(template.cases.some((item) => item.category === row.category), `template must include ${row.category}`);
const incomplete = evaluator(template);
assert.equal(incomplete.releaseReady, false);
assert.ok(incomplete.blockers.includes("pending_cases"));

const goodPath = path.join(temp, "good.json");
const unsafePath = path.join(temp, "unsafe.json");
writeFileSync(goodPath, JSON.stringify({ hardware: { platform: "windows", edgeVersion: "uat", microphone: "field-mic" }, cases: [...Array.from({ length: 50 }, (_, index) => caseRow(index)), ...requiredSafety] }));
writeFileSync(unsafePath, JSON.stringify({ hardware: { platform: "windows", edgeVersion: "uat", microphone: "field-mic" }, cases: [...Array.from({ length: 50 }, (_, index) => caseRow(index)), ...requiredSafety.map((row) => row.id === "competing" ? { ...row, actualProgram: "live", programCommandQueuedAt: new Date(new Date(row.recognitionFinalizedAt).getTime() + 700).toISOString() } : row)] }));
const goodCli = spawnSync(process.execPath, [cliPath, goodPath], { encoding: "utf8" });
assert.equal(goodCli.status, 0, goodCli.stderr || goodCli.stdout);
assert.equal(JSON.parse(goodCli.stdout).releaseReady, true);
const unsafeCli = spawnSync(process.execPath, [cliPath, unsafePath], { encoding: "utf8" });
assert.notEqual(unsafeCli.status, 0, "unsafe field-UAT report must block release");
assert.equal(JSON.parse(unsafeCli.stdout).releaseReady, false);

console.log(JSON.stringify({ ok: true, releaseGate: true, cliGate: true, minimumExplicitReferences: 50, requiredSafetyCategories: requiredSafety.map((row) => row.category), latencyP95TargetMs: 1500 }));
