#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = {
  cockpit: "../src/components/cockpit/CockpitMobile.tsx",
  workspace: "../src/components/cockpit/CockpitWorkspace.tsx",
  strip: "../src/components/cockpit/mobile/MobileLiveStrip.tsx",
  nav: "../src/components/cockpit/mobile/MobileBottomNav.tsx",
  actions: "../src/components/cockpit/mobile/MobileQuickActions.tsx",
  projection: "../src/lib/cockpit/role-projection.ts"
};
for (const relative of Object.values(files)) await access(new URL(relative, import.meta.url));
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), "utf8")])));

for (const component of ["MobileLiveStrip", "MobileBottomNav", "MobileQuickActions"]) {
  assert.match(source.cockpit, new RegExp(component), `CockpitMobile must compose ${component}`);
}
assert.doesNotMatch(source.workspace, /<StudioMobileNav\b/, "Cockpit must not render the legacy floating mobile menu alongside Live Assist nav");

for (const label of ["PROGRAM", "PREVIEW", "NEXT"]) assert.ok(source.strip.includes(label), `live strip must persist ${label}`);
assert.match(source.strip, /AUTO SCRIPTURE LIVE ARMED/, "authorized operators must see armed Auto Scripture Live state");
assert.match(source.strip, /sticky/, "live state strip must remain persistent while scrolling");
assert.match(source.strip, /projection\.showPreview|showPreview/, "strip must respect projected Preview visibility");
assert.match(source.strip, /projection\.showNext|showNext/, "strip must respect projected Next visibility");
for (const engineeringCopy of [/healthy outputs/i, /degraded outputs/i, /encoder bitrate/i, /cpu/i]) {
  assert.doesNotMatch(source.strip, engineeringCopy, "mobile live strip must not become an engineering KPI surface");
}

for (const destination of ["live", "scripture", "service", "media_sources", "audience"]) {
  assert.ok(source.nav.includes(`\"${destination}\"`), `bottom nav must model ${destination}`);
}
assert.match(source.nav, /min-h-11|min-h-12|h-11|h-12/, "primary mobile navigation targets must be at least 44px");
assert.match(source.nav, /canOpenScripture/, "Scripture tab must be role projected");
assert.match(source.nav, /canOpenService/, "Service tab must be role projected");
assert.match(source.nav, /canOpenMedia|canOpenCameras/, "Media & Sources tab must be role projected");
assert.match(source.nav, /canOpenAudience/, "Audience tab must be role projected");

assert.match(source.projection, /canOpenService/, "role projection must own Service visibility");
assert.match(source.projection, /canOpenAudience/, "role projection must own Audience visibility");
assert.doesNotMatch(source.actions, /engineering|bitrate|encoder/i, "quick actions must not expose engineering clutter");
assert.match(source.actions, /min-h-11|min-h-12|h-11|h-12/, "quick actions must use touch-sized targets");

console.log(JSON.stringify({ ok: true, shellSplit: true, persistentLiveStrip: true, roleFilteredNav: true, touchTargets: 44, noEngineeringKpis: true }));
