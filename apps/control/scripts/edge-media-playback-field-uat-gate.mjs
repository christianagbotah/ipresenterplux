#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createEdgeMediaPlaybackFieldUatTemplate, evaluateEdgeMediaPlaybackFieldUat } from "../src/lib/edge-media-playback-field-uat.ts";

const args = process.argv.slice(2);
if (args[0] === "--init") {
  const outputPath = args[1];
  if (!outputPath) {
    console.error("Usage: edge-media-playback-field-uat-gate.mjs --init <report.json> [build-commit]");
    process.exit(2);
  }
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(createEdgeMediaPlaybackFieldUatTemplate(args[2] ?? ""), null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ initialized: true, path: path.resolve(outputPath) }));
  process.exit(0);
}

const reportPath = args[0];
if (!reportPath) {
  console.error("Usage: edge-media-playback-field-uat-gate.mjs <report.json>");
  process.exit(2);
}

try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = evaluateEdgeMediaPlaybackFieldUat(report);
  console.log(JSON.stringify(result));
  process.exit(result.releaseReady ? 0 : 2);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
