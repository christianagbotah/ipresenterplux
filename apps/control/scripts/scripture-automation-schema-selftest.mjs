#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

const migration = await readFile(new URL("../db/043_scripture_automation_policy.sql", import.meta.url), "utf8");
for (const token of [
  "auto_scripture_live_enabled",
  "scripture_automation_mode",
  "auto_scripture_reference_threshold",
  "auto_scripture_quote_threshold",
  "scripture_automation_armed_at",
  "scripture_automation_armed_by",
  "scripture_automation_suspended_reason"
]) {
  assert.ok(migration.includes(token), `migration must define ${token}`);
}
assert.match(migration, /DEFAULT\s+false/i);
assert.match(migration, /DEFAULT\s+'manual'/i);
assert.match(migration, /ON DELETE SET NULL/i);

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({
    ok:true,
    mode:"local-contract",
    database:"deferred-to-ci",
    defaultMode:"manual",
    organizationDefault:false,
    referenceFloor:98,
    quoteFloor:96
  }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function column(table, name) {
  const result = await client.query(
    `select column_name,data_type,is_nullable,column_default
       from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name=$2`,
    [table,name]
  );
  return result.rows[0] ?? null;
}

async function constraints(table) {
  const result = await client.query(
    `select c.conname,c.contype,pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       join pg_class t on t.oid=c.conrelid
       join pg_namespace n on n.oid=t.relnamespace
      where n.nspname='public' and t.relname=$1
      order by c.conname`,
    [table]
  );
  return result.rows;
}

const orgId=randomUUID(), campusId=randomUUID(), serviceId=randomUUID(), userId=randomUUID();
try {
  for (const [table,name] of [
    ["organizations","auto_scripture_live_enabled"],
    ["services","scripture_automation_mode"],
    ["services","auto_scripture_reference_threshold"],
    ["services","auto_scripture_quote_threshold"],
    ["services","scripture_automation_armed_at"],
    ["services","scripture_automation_armed_by"],
    ["services","scripture_automation_suspended_reason"]
  ]) {
    assert.ok(await column(table,name), `${table}.${name} must exist`);
  }

  assert.match((await column("organizations","auto_scripture_live_enabled")).column_default ?? "", /false/i);
  assert.match((await column("services","scripture_automation_mode")).column_default ?? "", /manual/i);
  assert.match((await column("services","auto_scripture_reference_threshold")).column_default ?? "", /98/);
  assert.match((await column("services","auto_scripture_quote_threshold")).column_default ?? "", /96/);

  const serviceConstraintRows=await constraints("services");
  const serviceChecks=serviceConstraintRows.map((row)=>row.definition).join("\n");
  for (const mode of ["manual","auto_preview","auto_live"]) assert.match(serviceChecks,new RegExp(`'${mode}'`));
  assert.match(serviceChecks,/auto_scripture_reference_threshold[^\n]*>=?[^\n]*98/i);
  assert.match(serviceChecks,/auto_scripture_reference_threshold[^\n]*<=[^\n]*100/i);
  assert.match(serviceChecks,/auto_scripture_quote_threshold[^\n]*>=?[^\n]*96/i);
  assert.match(serviceChecks,/auto_scripture_quote_threshold[^\n]*<=[^\n]*100/i);
  assert.ok(serviceConstraintRows.some((row)=>row.contype==="f" && /scripture_automation_armed_by/i.test(row.definition) && /users/i.test(row.definition) && /ON DELETE SET NULL/i.test(row.definition)),"arming user FK must SET NULL on user deletion");

  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Automation Schema Church',$2,'GH','Africa/Accra')`,[orgId,`automation-${orgId}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`,[campusId,orgId]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Arming Operator','active')`,[userId,`arming-${userId}@example.invalid`]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at) values ($1,$2,$3,'Schema Test Service','live',now(),now())`,[serviceId,orgId,campusId]);
  const defaults=await client.query(`select o.auto_scripture_live_enabled,s.scripture_automation_mode,s.auto_scripture_reference_threshold::float8 as reference_threshold,s.auto_scripture_quote_threshold::float8 as quote_threshold,s.scripture_automation_armed_at,s.scripture_automation_armed_by,s.scripture_automation_suspended_reason from organizations o join services s on s.organization_id=o.id where s.id=$1`,[serviceId]);
  assert.equal(defaults.rows[0].auto_scripture_live_enabled,false);
  assert.equal(defaults.rows[0].scripture_automation_mode,"manual");
  assert.equal(defaults.rows[0].reference_threshold,98);
  assert.equal(defaults.rows[0].quote_threshold,96);
  assert.equal(defaults.rows[0].scripture_automation_armed_at,null);
  assert.equal(defaults.rows[0].scripture_automation_armed_by,null);
  assert.equal(defaults.rows[0].scripture_automation_suspended_reason,null);

  await client.query("savepoint invalid_reference_threshold");
  await assert.rejects(()=>client.query(`update services set auto_scripture_reference_threshold=97.99 where id=$1`,[serviceId]),/check constraint/i);
  await client.query("rollback to savepoint invalid_reference_threshold");
  await client.query("release savepoint invalid_reference_threshold");

  await client.query("savepoint invalid_quote_threshold");
  await assert.rejects(()=>client.query(`update services set auto_scripture_quote_threshold=95.99 where id=$1`,[serviceId]),/check constraint/i);
  await client.query("rollback to savepoint invalid_quote_threshold");
  await client.query("release savepoint invalid_quote_threshold");

  await client.query(`update services set scripture_automation_mode='auto_live',scripture_automation_armed_at=now(),scripture_automation_armed_by=$2 where id=$1`,[serviceId,userId]);
  await client.query(`delete from users where id=$1`,[userId]);
  const afterDelete=await client.query(`select scripture_automation_mode,scripture_automation_armed_at,scripture_automation_armed_by from services where id=$1`,[serviceId]);
  assert.equal(afterDelete.rows[0].scripture_automation_mode,"auto_live");
  assert.ok(afterDelete.rows[0].scripture_automation_armed_at);
  assert.equal(afterDelete.rows[0].scripture_automation_armed_by,null);
  await client.query("rollback");

  console.log(JSON.stringify({ok:true,mode:"postgres",defaultMode:"manual",organizationDefault:false,referenceFloor:98,quoteFloor:96,armingUserDelete:"set-null"}));
} finally {
  await client.end();
}
