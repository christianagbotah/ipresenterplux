#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const catalog = JSON.parse(await fs.readFile(new URL("../src/config/demo-accounts.json", import.meta.url), "utf8"));
const moduleUrl = new URL("../src/lib/demo-login.ts", import.meta.url);
const helper = await import(moduleUrl.href).catch(() => null);
assert.ok(helper, "demo login selection helper must exist");
assert.equal(typeof helper.resolveDemoAccount, "function", "demo login selection helper must export resolveDemoAccount");

for (const account of catalog) {
  assert.deepEqual(
    helper.resolveDemoAccount(catalog, account.roleId),
    account,
    `${account.roleId} selection must resolve its configured credentials`
  );
}
assert.equal(helper.resolveDemoAccount(catalog, ""), null, "blank selection must not fill credentials");
assert.equal(helper.resolveDemoAccount(catalog, "not-a-role"), null, "unknown selection must not fill credentials");

console.log(JSON.stringify({ ok: true, selections: catalog.length, unknownSafe: true }));
