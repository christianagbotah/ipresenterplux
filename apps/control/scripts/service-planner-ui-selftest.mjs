#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const policy = await import("../src/lib/role-policy.js");
const capabilities = await import("../src/lib/role-capabilities.ts");

const allRoles = [
  "owner","admin","pastor","presenter_operator","media_operator",
  "translator","finance","welfare","group_leader","viewer"
];
const mutationRoles = new Set(["owner","admin","pastor","presenter_operator","media_operator"]);

for (const role of allRoles) {
  const caps = capabilities.roleCapabilities([role]);
  assert.equal(caps.canViewPlanner, true, `${role} must see Planner navigation`);
  assert.equal(caps.canPlanServices, mutationRoles.has(role), `${role} planner mutation affordance mismatch`);
}
assert.deepEqual(policy.PLANNER_VIEW_ROLES, allRoles);

async function readRequired(path, label) {
  try {
    return await fs.readFile(new URL(path, import.meta.url), "utf8");
  } catch {
    assert.fail(`${label} must exist`);
  }
}

const dashboard = await readRequired("../src/app/page.tsx", "dashboard");
assert.match(dashboard, /href=\{?"\/planner"\}?|"\/planner"/, "dashboard must link to /planner");
assert.match(dashboard, /capabilities\.canViewPlanner/, "dashboard Planner link must use canViewPlanner");

const plannerPage = await readRequired("../src/app/planner/page.tsx", "Planner page");
assert.match(plannerPage, /ServicePlannerList/, "Planner page must render service list");
assert.match(plannerPage, /CreateServiceDialog/, "Planner page must render create-service UI");
assert.match(plannerPage, /roleCapabilities/, "Planner page must derive shared capabilities");
assert.match(plannerPage, /canPlanServices/, "Planner page must pass mutation capability");
assert.match(plannerPage, /timezone/, "Planner page must load organization timezone");
assert.match(plannerPage, /bible_versions/, "Planner page must load locally enabled Bible versions");
assert.match(plannerPage, /campuses/, "Planner page must load organization campuses");

const listSource = await readRequired("../src/components/planner/ServicePlannerList.tsx", "ServicePlannerList");
for (const label of ["Upcoming", "Draft", "Ready", "Live", "Ended / Archive"]) {
  assert.match(listSource, new RegExp(label.replace(" / ", " \\/ ")), `Planner list must include ${label} filter`);
}
assert.match(listSource, /Intl\.DateTimeFormat/, "service schedule must use Intl.DateTimeFormat");
assert.match(listSource, /timeZone/, "service schedule must use organization timezone");
assert.match(listSource, /canPlanServices/, "service list mutation affordances must be capability gated");
assert.match(listSource, /\/planner\/\$\{/, "service rows must link into the service planner workspace");
assert.doesNotMatch(listSource, /w-\[(?:[6-9]\d\d|\d{4,})px\]/, "Planner list must not introduce fixed desktop-width overflow");

const createSource = await readRequired("../src/components/planner/CreateServiceDialog.tsx", "CreateServiceDialog");
assert.match(createSource, /canPlanServices/, "create dialog must be capability gated");
for (const field of ["title", "serviceType", "campusId", "scheduledStart", "activeBibleVersion"]) {
  assert.match(createSource, new RegExp(field), `create dialog must include ${field}`);
}
assert.match(createSource, /\/api\/v1\/planner\/services/, "create dialog must call planner service API");
assert.match(createSource, /router\.push\(`\/planner\/\$\{/, "successful create must navigate to service planner detail");
assert.match(createSource, /400|403|409/, "create dialog must surface safe API validation/authorization/conflict failures");
assert.doesNotMatch(createSource, /w-\[(?:[6-9]\d\d|\d{4,})px\]/, "create dialog must remain responsive");

console.log(JSON.stringify({
  ok: true,
  roles: allRoles.length,
  filters: 5,
  timezoneAware: true,
  responsive: true,
  mutationGating: true
}));
