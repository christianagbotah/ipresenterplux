#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const [dashboard, operator, workspace, stage, focus, nextRail, nextActions, commands, attention, mobile, mobileNav, routeManifestTest] = await Promise.all([
  read("../src/app/DashboardPage.tsx"), read("../src/app/operator/page.tsx"), read("../src/components/cockpit/CockpitWorkspace.tsx"),
  read("../src/components/cockpit/ProgramPreviewStage.tsx"), read("../src/components/cockpit/FocusMode.tsx"),
  read("../src/components/cockpit/NextRail.tsx"), read("../src/components/cockpit/NextItemActions.tsx"),
  read("../src/lib/cockpit/commands.ts"), read("../src/lib/cockpit/attention.ts"), read("../src/components/cockpit/CockpitMobile.tsx"),
  read("../src/components/navigation/StudioMobileNav.tsx"), read("./studio-route-manifest-selftest.mjs")
]);

assert.match(dashboard, /CockpitWorkspace/, "Control Room must use the shared Cockpit");
assert.match(operator, /CockpitWorkspace/, "Operator compatibility route must use the same Cockpit");
assert.match(workspace, /CockpitMobile/, "shared Cockpit must have a purpose-built mobile projection");
assert.match(workspace, /CockpitDepthControls/, "desktop Cockpit must retain progressive depth");
assert.doesNotMatch(workspace, /grid-cols-4[^\n]*(KPI|Metric|Stats)/i, "default Cockpit must not become a KPI-card wall");

const programSurface = stage.indexOf('kind === "program"');
assert.ok(programSurface >= 0, "Program surface must be explicitly distinguished from Preview");
assert.match(stage, /md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.35fr\)\]/, "Program must remain visually dominant over Preview from desktop layouts onward");
assert.match(stage, /min-h-14/, "TAKE must expose a touch-sized primary target");
assert.match(stage, /min-h-12/, "Clear Program must expose a touch-sized primary target");
assert.match(stage, /Ctrl\/⌘ \+ Enter/, "keyboard TAKE safety contract must remain visible");
assert.match(focus, /Focus Mode/);
assert.match(focus, /ProgramPreviewStage/);
assert.match(focus, /NextRail/);
assert.match(focus, /Attention/);
assert.match(focus, /Command/);

assert.match(nextRail, /NextItemActions/, "Next must expose explicit operator actions");
assert.doesNotMatch(nextActions, /program\.show|program\.clear|state:\s*["']live["']/, "Predictive Next actions must never mutate Program directly");
assert.match(nextActions, /state:\s*"preview"/, "safe Scripture recommendation may prepare Preview");

assert.doesNotMatch(commands, /program\.show|program\.take|program\.clear/, "typed command registry must not expose direct Program intents");
assert.match(commands, /needs_confirmation/, "ambiguous consequential commands must support explicit confirmation");
assert.match(attention, /impact:/, "attention items must explain impact");
assert.match(attention, /containment:/, "attention items must explain containment");
assert.match(attention, /recommendedAction:/, "attention items must recommend recovery");

for (const profile of ["producer","pastor_service_leader","interpreter","media_lead","restricted"]) {
  assert.match(mobile, new RegExp(`data-cockpit-mobile-profile=["']${profile}["']`), `mobile profile ${profile} must be explicitly rendered`);
}
assert.doesNotMatch(mobile, /Engineering detail|Advanced live systems/, "mobile must not be a compressed engineering console");
assert.match(mobileNav, /min-h-12/, "mobile navigation targets must remain touch-sized");
assert.doesNotMatch(stage, /group-hover:[^\s]*(TAKE|Clear)/i, "primary live controls must not depend on hover");

assert.match(routeManifestTest, /"\/page":"\/"/, "post-build manifest gate must verify the main Cockpit route");
assert.match(routeManifestTest, /"\/operator\/page":"\/operator"/, "post-build manifest gate must verify the Operator compatibility route");

for (const route of ["/scripture","/media","/cameras","/streaming","/audience","/archive","/settings"]) {
  const escaped = route.replaceAll("/", "\\/");
  assert.ok(new RegExp(escaped).test(await read("../src/components/navigation/studio-routes.ts")), `${route} must remain a deep-work route`);
}
console.log(JSON.stringify({ok:true,sharedCockpit:true,programPreviewDominance:true,focusMode:true,predictiveSafety:true,typedCommands:true,impactRecovery:true,roleMobile:true,touchTargets:true,noHoverOnlyPrimary:true,noKpiWall:true,domainRoutesPreserved:true}));
