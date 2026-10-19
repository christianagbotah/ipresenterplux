#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = {
  control: "../src/components/scripture/ScriptureAutomationControl.tsx",
  workspace: "../src/components/scripture/ScriptureWorkspace.tsx",
  scripturePage: "../src/app/scripture/page.tsx",
  header: "../src/components/cockpit/CockpitHeader.tsx",
  mobile: "../src/components/cockpit/CockpitMobile.tsx",
  contracts: "../src/lib/cockpit/contracts.ts",
  viewModel: "../src/lib/cockpit/view-model.ts",
  currentService: "../src/lib/current-service.ts",
  ingest: "../src/lib/transcript-ingest.ts",
  settings: "../src/app/settings/page.tsx",
  settingsPage: "../src/app/settings/scripture-automation/page.tsx"
};
for (const relative of Object.values(files)) await access(new URL(relative, import.meta.url));
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), "utf8")])));

for (const label of ["Manual", "Auto Preview", "Auto Scripture Live"]) {
  assert.ok(source.control.includes(label), `automation control must expose '${label}'`);
}
assert.match(source.control, /Arm Auto Scripture Live/, "auto-live mode selection must have a separate arm action");
assert.match(source.control, />Disarm</, "armed service must expose a one-action Disarm control");
assert.match(source.control, /selectMode[\s\S]*update\(nextMode,\s*false\)/, "selecting a mode must not silently arm Auto Scripture Live");
assert.match(source.control, /referenceThreshold[^\n]*98|min=\{98\}|min="98"/, "reference threshold floor must be 98");
assert.match(source.control, /quoteThreshold[^\n]*96|min=\{96\}|min="96"/, "quote threshold floor must be 96");
assert.match(source.control, /\/api\/v1\/services\/\$\{(?:props\.)?serviceId\}\/scripture-automation/, "service controls must use governed automation API");
assert.match(source.control, /\/api\/v1\/settings\/scripture-automation/, "organization permission control must use governed settings API");
for (const reason of ["Organization permission is off", "Service must be live", "Active Edge required"]) {
  assert.ok(source.control.includes(reason), `disabled reason '${reason}' must be operator-visible`);
}
assert.match(source.workspace, /ScriptureAutomationControl/, "Scripture workspace must expose the service automation control");
assert.match(source.scripturePage, /scriptureAutomation/, "Scripture page must project service automation policy into the workspace");

assert.match(source.control, /AUTO SCRIPTURE LIVE ARMED/, "shared control must render the unmistakable armed state");
for (const cockpit of [source.header, source.mobile]) {
  assert.match(cockpit, /ScriptureAutomationControl/, "Cockpit desktop/mobile must reuse one-action disarm control");
  assert.match(cockpit, /scriptureAutomation\.armed/, "Cockpit desktop/mobile must project armed state persistently");
}
assert.match(source.contracts, /scriptureAutomation/, "Cockpit service contract must include automation state");
for (const token of ["mode", "armed", "referenceThreshold", "quoteThreshold", "organizationAutoLiveEnabled", "suspendedReason"]) {
  assert.match(source.contracts + source.currentService + source.viewModel, new RegExp(token), `automation projection must include ${token}`);
}
assert.match(source.viewModel, /scriptureAutomation/, "Cockpit view model must derive automation status from service policy");
assert.match(source.ingest, /sent to Preview/, "automation fallback copy must say when a detection went to Preview");
assert.match(source.ingest, /kept in Next/, "automation fallback copy must say when a detection stayed in Next");

assert.match(source.settings, /\/settings\/scripture-automation/, "Settings must link to Scripture automation governance");
assert.match(source.settingsPage, /owner|admin/, "organization automation settings must remain owner\/admin scoped");
assert.match(source.settingsPage, /ScriptureAutomationControl/, "settings page must reuse governed organization permission control");
assert.match(source.settingsPage, /Auto Scripture Live/, "settings page must explain Auto Scripture Live permission");

console.log(JSON.stringify({
  ok: true,
  modes: ["manual", "auto_preview", "auto_live"],
  separateArmAction: true,
  persistentArmedLabel: true,
  oneActionDisarm: true,
  thresholdFloors: { reference: 98, quote: 96 },
  organizationPermission: true
}));
