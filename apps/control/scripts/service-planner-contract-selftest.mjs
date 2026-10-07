#!/usr/bin/env node
import assert from "node:assert/strict";

const policy = await import("../src/lib/role-policy.js");
const capabilities = await import("../src/lib/role-capabilities.ts");
const contracts = await import("../src/lib/planner-contracts.ts");
const revisionModule = await import("../src/lib/planner-revision.ts");

const allRoles = [
  "owner",
  "admin",
  "pastor",
  "presenter_operator",
  "media_operator",
  "translator",
  "finance",
  "welfare",
  "group_leader",
  "viewer"
];
const mutationRoles = ["owner", "admin", "pastor", "presenter_operator", "media_operator"];

assert.deepEqual(policy.PLANNER_VIEW_ROLES, allRoles, "planner view roles must cover all ten organization roles");
assert.deepEqual(policy.PLANNER_MUTATION_ROLES, mutationRoles, "planner mutation roles must match the approved five roles exactly");

for (const role of allRoles) {
  const caps = capabilities.roleCapabilities([role]);
  assert.equal(caps.canViewPlanner, true, `${role} must be able to view Planner`);
  assert.equal(caps.canPlanServices, mutationRoles.includes(role), `${role} planner mutation capability mismatch`);
}

assert.equal(contracts.PLANNER_MAX_ITEMS, 200);
assert.equal(contracts.PLANNER_MAX_SONG_SECTIONS, 64);
assert.equal(contracts.PLANNER_BODY_MAX, 12000);
assert.equal(contracts.PLANNER_FOOTER_MAX, 500);

const base = {
  serviceId: "11111111-1111-1111-1111-111111111111",
  serviceUpdatedAt: "2026-10-07T09:00:00.000Z",
  items: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      itemType: "slide",
      sortOrder: 1000,
      state: "draft",
      updatedAt: "2026-10-07T09:00:00.000Z"
    }
  ]
};

const revision = revisionModule.computePlannerRevision(base);
assert.match(revision, /^[0-9a-f]{24}$/);
assert.equal(revisionModule.computePlannerRevision(structuredClone(base)), revision, "identical planner state must produce stable revision");

for (const changed of [
  { ...base, serviceUpdatedAt: "2026-10-07T09:00:01.000Z" },
  { ...base, items: [{ ...base.items[0], updatedAt: "2026-10-07T09:00:01.000Z" }] },
  { ...base, items: [{ ...base.items[0], sortOrder: 2000 }] },
  { ...base, items: [{ ...base.items[0], state: "ready" }] },
  { ...base, items: [...base.items, { ...base.items[0], id: "33333333-3333-3333-3333-333333333333", sortOrder: 2000 }] }
]) {
  assert.notEqual(revisionModule.computePlannerRevision(changed), revision, "planner revision must change when authoritative state changes");
}

console.log(JSON.stringify({ ok: true, roles: allRoles.length, mutationRoles: mutationRoles.length, revision: true }));
