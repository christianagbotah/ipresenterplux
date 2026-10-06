#!/usr/bin/env node
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import pg from "pg";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const organizationId = "00000000-0000-4000-8000-000000000001";
const catalog = JSON.parse(await fs.readFile(new URL("../src/config/demo-accounts.json", import.meta.url), "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("begin");
  const organization = await client.query("select id from organizations where id=$1::uuid", [organizationId]);
  if (!organization.rowCount) throw new Error("demo organization is missing");

  const roleRows = await client.query("select id from roles where id=any($1::text[])", [catalog.map((item) => item.roleId)]);
  if (roleRows.rowCount !== catalog.length) throw new Error("demo role catalog is incomplete in the database");

  for (const account of catalog) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    const existing = await client.query("select id from users where lower(email)=lower($1) limit 1", [account.email]);
    let userId = existing.rows[0]?.id;

    if (userId) {
      await client.query(
        `update users
         set display_name=$2,password_hash=$3,status='active',force_password_change=false,updated_at=now()
         where id=$1::uuid`,
        [userId, `Demo ${account.label}`, passwordHash]
      );
    } else {
      const inserted = await client.query(
        `insert into users(email,display_name,password_hash,status,force_password_change)
         values ($1,$2,$3,'active',false)
         returning id`,
        [account.email, `Demo ${account.label}`, passwordHash]
      );
      userId = inserted.rows[0].id;
    }

    await client.query(
      `delete from user_organization_roles
       where user_id=$1::uuid and organization_id=$2::uuid`,
      [userId, organizationId]
    );
    await client.query(
      `insert into user_organization_roles(user_id,organization_id,role_id)
       values ($1::uuid,$2::uuid,$3)`,
      [userId, organizationId, account.roleId]
    );
  }

  await client.query(
    `insert into audit_events(organization_id,actor_type,action,entity_type,entity_id,details)
     values ($1::uuid,'system','demo.accounts.seeded','organization',$1,$2::jsonb)`,
    [organizationId, JSON.stringify({ count: catalog.length, roles: catalog.map((item) => item.roleId) })]
  );
  await client.query("commit");
  console.log(JSON.stringify({ ok: true, demoUsers: catalog.length, organizationId }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
