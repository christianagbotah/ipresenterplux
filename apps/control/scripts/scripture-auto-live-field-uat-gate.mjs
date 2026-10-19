#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { createAutoScriptureLiveFieldUatTemplate, evaluateAutoScriptureLiveFieldUat } from "../src/lib/scripture-auto-live-field-uat.ts";

const command = process.argv[2];
if (!command) {
  console.error("Usage: node scripts/scripture-auto-live-field-uat-gate.mjs <field-uat-report.json> | --init <field-uat-report.json>");
  process.exit(64);
}

if (command === "--init") {
  const outputPath = process.argv[3];
  if (!outputPath) {
    console.error("Usage: node scripts/scripture-auto-live-field-uat-gate.mjs --init <field-uat-report.json>");
    process.exit(64);
  }
  await writeFile(outputPath, `${JSON.stringify(createAutoScriptureLiveFieldUatTemplate(), null, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
  process.exit(0);
}

const reportPath = command;
try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = evaluateAutoScriptureLiveFieldUat(report);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.releaseReady) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
