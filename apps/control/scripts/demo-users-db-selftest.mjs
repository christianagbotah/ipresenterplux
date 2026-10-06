#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import pg from "pg";

process.loadEnvFile?.(".env.local");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");

const organizationId = "00000000-0000-4000-8000-000000000001";
const catalog = JSON.parse(await fs.readFile(new URL("../src/config/demo-accounts.json", import.meta.url), "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  for (const account of catalog) {
    const result = await client.query(
      `select u.id::text,u.email,u.display_name,u.password_hash,u.status,u.force_password_change,
              coalesce(array_agg(uor.role_id order by uor.role_id) filter (where uor.role_id is not null), array[]::text[]) as roles
       from users u
       left join user_organization_roles uor
         on uor.user_id=u.id and uor.organization_id=$2::uuid
       where lower(u.email)=lower($1)
       group by u.id,u.email,u.display_name,u.password_hash,u.status,u.force_password_change`,
      [account.email, organizationId]
    );
    assert.equal(result.rowCount, 1, `${account.roleId} demo user must exist`);
    const user = result.rows[0];
    assert.equal(user.status, "active", `${account.roleId} demo user must be active`);
    assert.equal(user.force_password_change, false, `${account.roleId} demo user must not force a password change`);
    assert.deepEqual(user.roles, [account.roleId], `${account.roleId} demo user must have exactly one organization role`);
    assert.ok(user.password_hash, `${account.roleId} demo user must have a password hash`);
    assert.equal(await bcrypt.compare(account.password, user.password_hash), true, `${account.roleId} demo password must authenticate`);
  }

  const emails = catalog.map((item) => item.email.toLowerCase());
  const count = await client.query(
    `select count(*)::int as total from users where lower(email)=any($1::text[])`,
    [emails]
  );
  assert.equal(count.rows[0].total, catalog.length, "database must contain exactly the configured demo-user emails");

  console.log(JSON.stringify({ ok: true, demoUsers: catalog.length, roleIsolation: true, passwordVerified: true }));
} finally {
  await client.end();
}
