#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { THEME_STUDIO_REQUIRED_UAT_CATEGORIES, evaluateThemeStudioFieldUat } from "../src/lib/theme-studio-field-uat.ts";

const [, , first, second] = process.argv;
function template() {
  return {
    hardware: { platform: "windows", edgeVersion: "", projector: "", resolution: "1920x1080" },
    cases: THEME_STUDIO_REQUIRED_UAT_CATEGORIES.map((category) => ({
      id: category,
      category,
      status: "pending",
      readable: null,
      programMutationObserved: null,
      notes: ""
    }))
  };
}
if (first === "--init") {
  if (!second) throw new Error("Usage: theme-studio-field-uat-gate.mjs --init <report.json>");
  await writeFile(second, JSON.stringify(template(), null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, initialized: second, cases: THEME_STUDIO_REQUIRED_UAT_CATEGORIES.length }));
  process.exit(0);
}
if (!first) throw new Error("Usage: theme-studio-field-uat-gate.mjs <report.json>");
const report = JSON.parse(await readFile(first, "utf8"));
const result = evaluateThemeStudioFieldUat(report);
console.log(JSON.stringify(result, null, 2));
process.exit(result.releaseReady ? 0 : 1);
