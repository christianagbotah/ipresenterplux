#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const catalogPath = new URL("../src/config/demo-accounts.json", import.meta.url);
const rolesSqlPath = new URL("../db/003_security_foundation.sql", import.meta.url);

const rawCatalog = await fs.readFile(catalogPath, "utf8").catch(() => null);
assert.ok(rawCatalog, "demo account catalog must exist");

const catalog = JSON.parse(rawCatalog);
assert.equal(Array.isArray(catalog), true, "demo account catalog must be an array");
assert.equal(catalog.length, 10, "demo catalog must expose every supported role exactly once");

const sql = await fs.readFile(rolesSqlPath, "utf8");
const rolesBlock = sql.match(/INSERT INTO roles[\s\S]*?ON CONFLICT \(id\)/)?.[0] ?? "";
const roleIds = [...rolesBlock.matchAll(/\('([^']+)',\s*'[^']+',\s*'[^']+'\)/g)].map((match) => match[1]);
assert.equal(roleIds.length, 10, "security foundation must define ten roles for this contract test");

const catalogRoleIds = catalog.map((item) => item.roleId);
assert.deepEqual(new Set(catalogRoleIds), new Set(roleIds), "demo catalog must match the RBAC role catalog");
assert.equal(new Set(catalogRoleIds).size, catalog.length, "role IDs must be unique");
assert.equal(new Set(catalog.map((item) => item.email.toLowerCase())).size, catalog.length, "demo emails must be unique");

for (const item of catalog) {
  assert.equal(typeof item.label, "string");
  assert.ok(item.label.trim().length >= 3, `${item.roleId} requires a visible role label`);
  assert.equal(typeof item.description, "string");
  assert.ok(item.description.trim().length >= 8, `${item.roleId} requires a useful description`);
  assert.match(item.email, /^demo\.[a-z0-9.]+@ipresenterplux\.local$/);
  assert.equal(item.password, "Demo@2026!", `${item.roleId} must use the documented public demo password`);
  assert.equal(typeof item.futureModule, "boolean", `${item.roleId} future-module state must be explicit`);
}

for (const roleId of ["finance", "welfare", "group_leader"]) {
  assert.equal(catalog.find((item) => item.roleId === roleId)?.futureModule, true, `${roleId} must be labeled future/in-progress`);
}
for (const roleId of roleIds.filter((id) => !["finance", "welfare", "group_leader"].includes(id))) {
  assert.equal(catalog.find((item) => item.roleId === roleId)?.futureModule, false, `${roleId} must not be labeled future-only`);
}

console.log(JSON.stringify({ ok: true, demoAccounts: catalog.length, roles: catalogRoleIds }));
