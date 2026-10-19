#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  BUILTIN_PRESENTATION_THEMES,
  DEFAULT_PRESENTATION_APPEARANCE,
  ensureBuiltinPresentationThemes,
  parsePresentationAppearance,
  presentationAppearanceSchema,
  resolvePresentationAppearance,
  resolveServicePresentationTheme
} from "../src/lib/presentation-themes.ts";

const migration = await readFile(new URL("../db/044_presentation_themes.sql", import.meta.url), "utf8");
for (const token of ["presentation_themes", "active_theme_id", "organization_id", "appearance", "is_builtin", "ON DELETE SET NULL"]) {
  assert.ok(migration.includes(token), `theme migration must define ${token}`);
}
for (const name of ["Sunday Modern", "Lower Third Scripture", "Sermon Scripture", "Worship Lyrics", "Announcement", "Youth Service", "Conference", "Funeral", "Wedding"]) {
  assert.ok(migration.includes(name), `migration must seed ${name}`);
}
assert.match(migration, /UNIQUE\s*\(\s*organization_id\s*,\s*name\s*\)/i);
assert.match(migration, /FOREIGN KEY\s*\(\s*active_theme_id\s*,\s*organization_id\s*\)/i, "active theme FK must enforce tenant ownership");

assert.equal(BUILTIN_PRESENTATION_THEMES.length, 9);
assert.deepEqual(BUILTIN_PRESENTATION_THEMES.map((theme) => theme.name), [
  "Sunday Modern", "Lower Third Scripture", "Sermon Scripture", "Worship Lyrics", "Announcement", "Youth Service", "Conference", "Funeral", "Wedding"
]);
assert.equal(presentationAppearanceSchema.parse(DEFAULT_PRESENTATION_APPEARANCE).version, 1);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, unknownKey: true }), /unrecognized|unknown/i);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, safeAreaPercent: 15.01 }), /15|too_big|maximum/i);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, backingOpacity: -0.01 }), /0|too_small|minimum/i);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, bodySizeScale: 0.1 }), /too_small|minimum|0\.5/i);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, fontFamily: "Comic Sans MS" }), /invalid|option/i);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, primaryTextColor: "red" }), /invalid|string|regex/i);
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, animation: "spin" }), /invalid|option/i);
assert.equal(parsePresentationAppearance(DEFAULT_PRESENTATION_APPEARANCE).animation, "fade");
assert.deepEqual(resolvePresentationAppearance({ version: 99, arbitrary: true }), DEFAULT_PRESENTATION_APPEARANCE, "invalid/unknown appearance must fail closed to built-in default");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok:true, mode:"local-contract", database:"deferred-to-ci", builtins:9, version:1, strict:true, tenantScoped:true }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const orgA=randomUUID(), orgB=randomUUID(), campusA=randomUUID(), serviceA=randomUUID(), userA=randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Theme Church A',$2,'GH','Africa/Accra'),($3,'Theme Church B',$4,'GH','Africa/Accra')`, [orgA,`theme-a-${orgA}`,orgB,`theme-b-${orgB}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`, [campusA,orgA]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Theme Owner','active')`, [userA,`theme-${userA}@example.invalid`]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start) values ($1,$2,$3,'Theme Service','ready',now())`, [serviceA,orgA,campusA]);

  await ensureBuiltinPresentationThemes(client, orgA, userA);
  await ensureBuiltinPresentationThemes(client, orgB, null);
  await ensureBuiltinPresentationThemes(client, orgA, userA);
  const builtinCounts = await client.query(`select organization_id::text,count(*)::int as count from presentation_themes where organization_id=any($1::uuid[]) and is_builtin=true group by organization_id`, [[orgA,orgB]]);
  assert.deepEqual(Object.fromEntries(builtinCounts.rows.map((row)=>[row.organization_id,row.count])), { [orgA]:9, [orgB]:9 }, "built-ins must be tenant-local and idempotent");

  const ownTheme = await client.query(`select id::text from presentation_themes where organization_id=$1 and name='Sunday Modern'`, [orgA]);
  const otherTheme = await client.query(`select id::text from presentation_themes where organization_id=$1 and name='Sunday Modern'`, [orgB]);
  assert.ok(ownTheme.rows[0]?.id && otherTheme.rows[0]?.id);

  await client.query(`update services set active_theme_id=$2 where id=$1`, [serviceA,ownTheme.rows[0].id]);
  const resolved = await resolveServicePresentationTheme(client, orgA, serviceA);
  assert.equal(resolved.theme?.name, "Sunday Modern");
  assert.equal(resolved.appearance.version, 1);

  await client.query("savepoint cross_tenant_theme");
  await assert.rejects(() => client.query(`update services set active_theme_id=$2 where id=$1`, [serviceA,otherTheme.rows[0].id]), /foreign key|violates/i);
  await client.query("rollback to savepoint cross_tenant_theme");
  await client.query("release savepoint cross_tenant_theme");

  await client.query(`delete from presentation_themes where id=$1`, [ownTheme.rows[0].id]);
  const afterDelete = await client.query(`select active_theme_id from services where id=$1`, [serviceA]);
  assert.equal(afterDelete.rows[0].active_theme_id, null, "deleting active theme must fall back by clearing assignment");
  const fallback = await resolveServicePresentationTheme(client, orgA, serviceA);
  assert.equal(fallback.theme, null);
  assert.deepEqual(fallback.appearance, DEFAULT_PRESENTATION_APPEARANCE);

  await client.query("rollback");
  console.log(JSON.stringify({ ok:true, mode:"postgres", builtins:9, tenantScoped:true, crossTenantBlocked:true, deleteFallback:true }));
} finally {
  await client.end();
}
