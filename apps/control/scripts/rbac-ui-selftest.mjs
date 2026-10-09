#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

let roleModule;
try {
  roleModule = await import("../src/lib/role-capabilities.ts");
} catch {
  roleModule = null;
}
assert.ok(roleModule?.roleCapabilities, "role capability helper must exist");

const cases = [
  ["owner", true, true, true, true, true, true],
  ["admin", true, true, true, true, true, true],
  ["pastor", true, false, false, false, true, true],
  ["presenter_operator", true, false, false, false, true, true],
  ["media_operator", true, true, false, false, true, true],
  ["translator", false, false, true, false, true, false],
  ["finance", false, false, false, false, true, false],
  ["welfare", false, false, false, false, true, false],
  ["group_leader", false, false, false, false, true, false],
  ["viewer", false, false, false, false, true, false]
];
for (const [role, canLiveControl, canStreaming, canTranslations, canSettings, canViewPlanner, canPlanServices] of cases) {
  assert.deepEqual(roleModule.roleCapabilities([role]), {
    canLiveControl,
    canStreaming,
    canTranslations,
    canSettings,
    canViewPlanner,
    canPlanServices
  }, `${role} capability mismatch`);
}
assert.deepEqual(roleModule.roleCapabilities(["viewer", "translator"]), {
  canLiveControl: false,
  canStreaming: false,
  canTranslations: true,
  canSettings: false,
  canViewPlanner: true,
  canPlanServices: false
}, "capabilities must union across memberships");

const page = await fs.readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const dashboardModule = await fs.readFile(new URL("../src/app/DashboardPage.tsx", import.meta.url), "utf8");
const cockpitViewModelSource = await fs.readFile(new URL("../src/lib/cockpit/view-model.ts", import.meta.url), "utf8");
const programPreviewSource = await fs.readFile(new URL("../src/components/cockpit/ProgramPreviewStage.tsx", import.meta.url), "utf8");
const dashboardSource = `${page}\n${dashboardModule}`;
assert.match(dashboardSource, /getCockpitViewModel/, "dashboard must use the authoritative Cockpit view model");
assert.match(cockpitViewModelSource, /getCurrentServiceForUser/, "Cockpit view model must use shared service/RBAC context");
assert.match(programPreviewSource, /model\.capabilities\.canLiveControl/, "shared Program/Preview stage must gate live controls from server capabilities");

const navModule = await import("../src/components/navigation/studio-routes.ts");
assert.ok(navModule?.visibleStudioRoutes, "shared studio navigation capability filter must exist");
const navigationCases = [
  ["Translations", "canTranslations"],
  ["Streaming", "canStreaming"],
  ["Settings", "canSettings"]
];
for (const [label, capability] of navigationCases) {
  const route = navModule.studioRoutes.find((item) => item.label === label);
  assert.equal(route?.capability, capability, `${label} must declare ${capability} on the shared route model`);
  const hidden = navModule.visibleStudioRoutes({ canTranslations: false, canStreaming: false, canSettings: false });
  assert.equal(hidden.some((item) => item.label === label), false, `${label} must be hidden without ${capability}`);
}

const sidebarSource = await fs.readFile(new URL("../src/components/navigation/StudioSidebar.tsx", import.meta.url), "utf8");
const mobileNavSource = await fs.readFile(new URL("../src/components/navigation/StudioMobileNav.tsx", import.meta.url), "utf8");
assert.match(sidebarSource, /visibleStudioRoutes\(capabilities\)/, "desktop navigation must apply shared capability filtering");
assert.match(mobileNavSource, /visibleStudioRoutes\(capabilities\)/, "mobile navigation must apply shared capability filtering");

const operatorPage = await fs.readFile(new URL("../src/app/operator/page.tsx", import.meta.url), "utf8");
assert.match(operatorPage, /getCockpitViewModel/, "Operator compatibility route must use the authoritative Cockpit view model");
assert.match(operatorPage, /CockpitWorkspace/, "Operator compatibility route must render the shared capability-filtered Cockpit");

const devicesPage = await fs.readFile(new URL("../src/app/settings/devices/page.tsx", import.meta.url), "utf8");
assert.match(devicesPage, /if \(!canManage\) redirect\("\/"\)/, "Edge Devices page must reject non-admin direct access");

console.log(JSON.stringify({ ok: true, roles: cases.length, multiRoleUnion: true, dashboardWiring: true, operatorWiring: true, deviceAdminRouteGuard: true }));
