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
assert.match(page, /roleCapabilities/, "dashboard must use the shared role capability helper");
assert.match(page, /capabilities\.canLiveControl/, "dashboard must gate live controls");
assert.match(page, /capabilities\.canTranslations/, "dashboard must gate Translations navigation");
assert.match(page, /capabilities\.canStreaming/, "dashboard must gate Streaming navigation");
assert.match(page, /capabilities\.canSettings/, "dashboard must gate Settings navigation");

const operatorPage = await fs.readFile(new URL("../src/app/operator/page.tsx", import.meta.url), "utf8");
assert.match(operatorPage, /data\.canStreaming/, "Operator page must gate Streaming navigation");
assert.match(operatorPage, /data\.canSettings/, "Operator page must gate Settings navigation");

const devicesPage = await fs.readFile(new URL("../src/app/settings/devices/page.tsx", import.meta.url), "utf8");
assert.match(devicesPage, /if \(!canManage\) redirect\("\/"\)/, "Edge Devices page must reject non-admin direct access");

console.log(JSON.stringify({ ok: true, roles: cases.length, multiRoleUnion: true, dashboardWiring: true, operatorWiring: true, deviceAdminRouteGuard: true }));
