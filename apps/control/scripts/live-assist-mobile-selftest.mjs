#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = {
  cockpit: "../src/components/cockpit/CockpitMobile.tsx",
  workspace: "../src/components/cockpit/CockpitWorkspace.tsx",
  strip: "../src/components/cockpit/mobile/MobileLiveStrip.tsx",
  nav: "../src/components/cockpit/mobile/MobileBottomNav.tsx",
  actions: "../src/components/cockpit/mobile/MobileQuickActions.tsx",
  find: "../src/components/cockpit/mobile/MobileFindBar.tsx",
  palette: "../src/components/cockpit/CommandPalette.tsx",
  stage: "../src/components/cockpit/ProgramPreviewStage.tsx",
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

assert.match(source.cockpit, /MobileFindBar/, "CockpitMobile must expose mobile Universal Find");
assert.match(source.find, /What do you need next\?/, "mobile find entry must use the approved prompt");
assert.match(source.find, /min-h-11|min-h-12|h-11|h-12/, "mobile find entry must be at least 44px");
assert.match(source.find, /ipresenterplux:command-open/, "mobile find must open the shared Universal Find surface");
assert.doesNotMatch(source.find, /\/api\/v1\/cockpit\/command|method:\s*["']POST["']/, "mobile find trigger must not mutate while typing or opening");
for (const label of ["Scripture", "Songs", "Media", "Service", "Visual Sources", "Actions"]) assert.ok(source.palette.includes(label), `shared mobile search must retain ${label} grouping`);
assert.match(source.palette, /onSubmit=\{submit\}/, "mobile search sheet must support keyboard/form submission");
assert.match(source.palette, /event\.key === ["']Escape["']/, "mobile search sheet must close safely with Escape");
assert.match(source.palette, /aria-label=["']Close universal find["']/, "mobile search sheet must expose an explicit back/close action");
assert.match(source.palette, /Search is temporarily unavailable\. Live controls remain available\./, "network loss must preserve live-control guidance");
assert.match(source.palette, /\/api\/v1\/cockpit\/search\?q=/, "typing must use the read-only search endpoint");
assert.match(source.palette, /\/api\/v1\/cockpit\/command/, "explicit submit must reuse the safe command endpoint");
assert.doesNotMatch(source.palette, /onChange=.*runCommand/, "typing must never execute a command");

assert.match(source.stage, /showControls/, "ProgramPreviewStage must support hiding Program controls for role-projected mobile views");
assert.match(source.stage, /showControls && model\.capabilities\.canLiveControl/, "TAKE/Clear authority must require both projection visibility and existing live capability");
assert.match(source.cockpit, /showControls=\{projection\.actions\.canTake \|\| projection\.actions\.canClear\}/, "producer mobile stage must project TAKE/Clear visibility from role actions");
assert.match(source.cockpit, /showControls=\{false\}/, "pastor/service-leader mobile stage must omit Program controls");
assert.match(source.actions, /ScriptureAutomationControl/, "mobile quick actions must reuse governed Auto Scripture Live control");
assert.match(source.actions, /compact/, "armed automation action must expose the compact one-tap Disarm control");
assert.match(source.actions, /scriptureAutomation\.armed/, "Disarm must only surface while Auto Scripture Live is armed");
assert.match(source.actions, /\/cameras/, "visual source quick action must route to the governed Visual Sources workspace");
assert.doesNotMatch(source.actions, /program\.show|program\.take|state:\s*["']live["']|\/api\/v1\/scriptures\//, "mobile quick actions must not create a direct Program mutation path");

console.log(JSON.stringify({ ok: true, shellSplit: true, persistentLiveStrip: true, roleFilteredNav: true, touchTargets: 44, noEngineeringKpis: true }));
