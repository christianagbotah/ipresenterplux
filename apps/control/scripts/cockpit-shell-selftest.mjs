#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const files = {
  dashboard: "../src/app/DashboardPage.tsx",
  operator: "../src/app/operator/page.tsx",
  workspace: "../src/components/cockpit/CockpitWorkspace.tsx",
  stage: "../src/components/cockpit/ProgramPreviewStage.tsx",
  now: "../src/components/cockpit/NowRail.tsx",
  next: "../src/components/cockpit/NextRail.tsx",
  header: "../src/components/cockpit/CockpitHeader.tsx"
};
for (const relative of Object.values(files)) await access(new URL(relative, import.meta.url));
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), "utf8")])));

for (const page of [source.dashboard, source.operator]) {
  assert.match(page, /getCockpitViewModel/, "both entry routes must use the authoritative Cockpit model");
  assert.match(page, /CockpitWorkspace/, "both entry routes must render the same Cockpit workspace");
}
assert.doesNotMatch(source.operator, /ScriptureOperatorWorkspace/, "operator compatibility route must not keep a second UI architecture");
assert.match(source.workspace, /ProgramPreviewStage/);
assert.match(source.workspace, /NowRail/);
assert.match(source.workspace, /NextRail/);
assert.match(source.workspace, /CockpitHeader/);
assert.match(source.stage, />TAKE</, "TAKE must remain an explicit live action");
assert.match(source.stage, /Clear Program/, "Clear Program must remain explicit");
assert.match(source.stage, /Program/);
assert.match(source.stage, /Preview/);
assert.match(source.stage, /Ctrl\/⌘ \+ Enter|Ctrl\/Cmd\+Enter|metaKey|ctrlKey/, "safe Take keyboard path must remain visible in implementation");
assert.match(source.workspace, /StudioSidebar/);
assert.match(source.workspace, /StudioMobileNav/);
for (const href of ["/scripture", "/media", "/cameras", "/streaming", "/audience", "/archive", "/settings"]) {
  assert.match(source.workspace + source.header, new RegExp(href.replaceAll("/", "\\/")), `Cockpit must keep ${href} reachable`);
}
assert.doesNotMatch(source.dashboard, /Presentation Engine[\s\S]*Scripture Intelligence[\s\S]*Broadcast Router[\s\S]*Language Engine/, "legacy KPI-card wall must not remain the default Control Room hierarchy");
console.log(JSON.stringify({ ok:true, sharedCockpit:true, programPreviewCentral:true, operatorCompatibility:true, domainRoutesPreserved:true }));
