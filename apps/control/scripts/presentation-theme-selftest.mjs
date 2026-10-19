#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  BUILTIN_PRESENTATION_THEMES,
  DEFAULT_PRESENTATION_APPEARANCE,
  PresentationThemeError,
  assignServicePresentationTheme,
  createPresentationTheme,
  deletePresentationTheme,
  ensureBuiltinPresentationThemes,
  getPresentationTheme,
  listPresentationThemes,
  parsePresentationAppearance,
  presentationAppearanceSchema,
  resolvePresentationAppearance,
  resolveThemeAppearance,
  resolveServicePresentationTheme,
  updatePresentationTheme
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

const rolesSource = await readFile(new URL("../src/lib/role-policy.js", import.meta.url), "utf8");
assert.match(rolesSource, /THEME_ADMIN_ROLES/);
for (const role of ["owner","admin","media_operator"]) assert.match(rolesSource, new RegExp(`THEME_ADMIN_ROLES[^;]*["\']${role}["\']`));
const rbacSource = await readFile(new URL("../src/lib/rbac.ts", import.meta.url), "utf8");
assert.match(rbacSource, /THEME_ADMIN_ROLES/);
const edgePresentationRoute = await readFile(new URL("../src/app/api/v1/edge/presentation/items/[id]/route.ts", import.meta.url), "utf8");
assert.match(edgePresentationRoute, /resolveServicePresentationTheme/, "Edge presentation content must resolve the active service Theme inside tenant scope");
assert.match(edgePresentationRoute, /resolveThemeAppearance/, "Edge presentation content must resolve content/output variants before transport");
assert.match(edgePresentationRoute, /themeAppearanceV1/, "Edge presentation metadata must carry one versioned bounded Theme payload");

for (const relative of ["../src/app/api/v1/themes/route.ts","../src/app/api/v1/themes/[id]/route.ts","../src/app/api/v1/services/[id]/theme/route.ts"]) {
  const route = await readFile(new URL(relative, import.meta.url), "utf8");
  assert.match(route, /auth\(\)/, `${relative} must authenticate`);
  assert.doesNotMatch(route, /program\.show|scriptures\/.+state|presentation_items[\s\S]*state\s*=|edge_control_commands/i, `${relative} must not bypass Program authority`);
}

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
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, background:{ kind:"gradient", value:"url(https://example.invalid/x)" } }), /invalid|option/i, "background must use portable bounded tokens, not arbitrary CSS/URLs");
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, animation: "spin" }), /invalid|option/i);
assert.equal(parsePresentationAppearance(DEFAULT_PRESENTATION_APPEARANCE).animation, "fade");
assert.deepEqual(resolvePresentationAppearance({ version: 99, arbitrary: true }), DEFAULT_PRESENTATION_APPEARANCE, "invalid/unknown appearance must fail closed to built-in default");

const variantTheme = presentationAppearanceSchema.parse({
  ...DEFAULT_PRESENTATION_APPEARANCE,
  contentVariants: {
    scripture: { bodySizeScale: 1.4, horizontalAlignment: "left", background: { kind: "gradient", value: "navy_teal" } },
    song: { bodySizeScale: 1.5, secondaryTextColor: "#22d3ee" },
    announcement: { titleSizeScale: 1.35 },
    generic: { backingOpacity: 0.25 }
  },
  outputVariants: {
    projector: { safeAreaPercent: 9, background: { kind: "gradient", value: "midnight" } },
    stream: { footerSizeScale: 0.8, secondaryTextColor: "#fde047" },
    audience: { bodySizeScale: 0.95 }
  }
});
const scriptureProjector = resolveThemeAppearance(variantTheme, { contentType: "scripture", output: "projector" });
assert.equal(scriptureProjector.bodySizeScale, 1.4, "content variant must override base appearance");
assert.equal(scriptureProjector.horizontalAlignment, "left");
assert.equal(scriptureProjector.safeAreaPercent, 9, "output variant must apply after content variant");
assert.deepEqual(scriptureProjector.background, { kind: "gradient", value: "midnight" }, "output background must atomically replace content background");
const songStream = resolveThemeAppearance(variantTheme, { contentType: "song", output: "stream" });
assert.equal(songStream.bodySizeScale, 1.5);
assert.equal(songStream.secondaryTextColor, "#fde047", "output variant must win when both layers override one scalar");
assert.equal(songStream.footerSizeScale, 0.8);
const genericAudience = resolveThemeAppearance(variantTheme, { contentType: "generic", output: "audience" });
assert.equal(genericAudience.backingOpacity, 0.25);
assert.equal(genericAudience.bodySizeScale, 0.95);
assert.equal(Object.hasOwn(scriptureProjector, "contentVariants"), false, "resolved appearance sent to output must not retain variant definitions");
assert.equal(Object.hasOwn(scriptureProjector, "outputVariants"), false, "resolved appearance sent to output must not retain variant definitions");
assert.throws(() => presentationAppearanceSchema.parse({ ...DEFAULT_PRESENTATION_APPEARANCE, contentVariants: { scripture: { lowerThird: { mode: "always" } } } }), /position|required|invalid/i, "nested override objects must replace atomically rather than partially merging unsafe shapes");
const invalidVariantResolved = resolveThemeAppearance({ ...DEFAULT_PRESENTATION_APPEARANCE, contentVariants: { scripture: { background: { kind: "gradient", value: "url(https://example.invalid/x)" } } } }, { contentType: "scripture", output: "projector" });
assert.equal(invalidVariantResolved.background.kind, DEFAULT_PRESENTATION_APPEARANCE.background.kind, "invalid variant payload must fail closed to the default theme");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok:true, mode:"local-contract", database:"deferred-to-ci", builtins:9, version:1, strict:true, tenantScoped:true }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const orgA=randomUUID(), orgB=randomUUID(), campusA=randomUUID(), serviceA=randomUUID();
const ownerA=randomUUID(), mediaA=randomUUID(), presenterA=randomUUID(), viewerA=randomUUID(), outsiderB=randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Theme Church A',$2,'GH','Africa/Accra'),($3,'Theme Church B',$4,'GH','Africa/Accra')`, [orgA,`theme-a-${orgA}`,orgB,`theme-b-${orgB}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`, [campusA,orgA]);
  await client.query(`insert into users(id,email,display_name,status) values
    ($1,$2,'Theme Owner','active'),($3,$4,'Theme Media','active'),($5,$6,'Theme Presenter','active'),($7,$8,'Theme Viewer','active'),($9,$10,'Theme Outsider','active')`,
    [ownerA,`owner-${ownerA}@example.invalid`,mediaA,`media-${mediaA}@example.invalid`,presenterA,`presenter-${presenterA}@example.invalid`,viewerA,`viewer-${viewerA}@example.invalid`,outsiderB,`outsider-${outsiderB}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values
    ($1,$2,'owner'),($3,$2,'media_operator'),($4,$2,'presenter_operator'),($5,$2,'viewer'),($6,$7,'owner')`,
    [ownerA,orgA,mediaA,presenterA,viewerA,outsiderB,orgB]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start) values ($1,$2,$3,'Theme Service','ready',now())`, [serviceA,orgA,campusA]);

  await ensureBuiltinPresentationThemes(client, orgA, ownerA);
  await ensureBuiltinPresentationThemes(client, orgB, null);
  await ensureBuiltinPresentationThemes(client, orgA, ownerA);
  const builtinCounts = await client.query(`select organization_id::text,count(*)::int as count from presentation_themes where organization_id=any($1::uuid[]) and is_builtin=true group by organization_id`, [[orgA,orgB]]);
  assert.deepEqual(Object.fromEntries(builtinCounts.rows.map((row)=>[row.organization_id,row.count])), { [orgA]:9, [orgB]:9 }, "built-ins must be tenant-local and idempotent");

  const listed = await listPresentationThemes(client, viewerA, orgA);
  assert.equal(listed.length, 9, "authorized organization member may list presentation themes");
  await assert.rejects(() => listPresentationThemes(client, outsiderB, orgA), (error) => error instanceof PresentationThemeError && error.status === 403);

  const customAppearance = { ...DEFAULT_PRESENTATION_APPEARANCE, secondaryTextColor: "#22d3ee", safeAreaPercent: 7 };
  const custom = await createPresentationTheme(client, mediaA, orgA, { name:"Media Custom", templateKey:"media_custom", appearance:customAppearance });
  assert.equal(custom.name,"Media Custom");
  assert.equal(custom.isBuiltin,false);
  await assert.rejects(() => createPresentationTheme(client, viewerA, orgA, { name:"Forbidden", templateKey:"forbidden", appearance:customAppearance }), (error) => error instanceof PresentationThemeError && error.status === 403);
  const fetched = await getPresentationTheme(client, viewerA, custom.id);
  assert.equal(fetched.id, custom.id);
  await assert.rejects(() => getPresentationTheme(client, outsiderB, custom.id), (error) => error instanceof PresentationThemeError && error.status === 403);
  const updatedCustom = await updatePresentationTheme(client, ownerA, custom.id, { name:"Media Custom Updated", appearance:{ ...customAppearance, bodySizeScale:1.1 } });
  assert.equal(updatedCustom.name,"Media Custom Updated");

  const builtinA = await client.query(`select id::text from presentation_themes where organization_id=$1 and name='Sunday Modern'`, [orgA]);
  await assert.rejects(() => updatePresentationTheme(client, ownerA, builtinA.rows[0].id, { name:"Cannot Rename" }), (error) => error instanceof PresentationThemeError && error.code === "builtin_theme_immutable");
  await assert.rejects(() => deletePresentationTheme(client, ownerA, builtinA.rows[0].id), (error) => error instanceof PresentationThemeError && error.code === "builtin_theme_immutable");

  const assigned = await assignServicePresentationTheme(client, presenterA, serviceA, custom.id);
  assert.equal(assigned.themeId,custom.id);
  await assert.rejects(() => assignServicePresentationTheme(client, viewerA, serviceA, custom.id), (error) => error instanceof PresentationThemeError && error.status === 403);
  const otherBuiltin = await client.query(`select id::text from presentation_themes where organization_id=$1 and name='Sunday Modern'`, [orgB]);
  await assert.rejects(() => assignServicePresentationTheme(client, presenterA, serviceA, otherBuiltin.rows[0].id), (error) => error instanceof PresentationThemeError && error.code === "theme_not_found");
  const audit = await client.query(`select action,details from audit_events where organization_id=$1 and action like 'presentation.theme.%' order by id`, [orgA]);
  for (const action of ["presentation.theme.created","presentation.theme.updated","presentation.theme.assigned"]) assert.ok(audit.rows.some((row)=>row.action===action), `audit must include ${action}`);
  for (const row of audit.rows) assert.equal(Object.hasOwn(row.details,"appearance"),false,"theme audit must not embed full appearance/media payload");

  await deletePresentationTheme(client, mediaA, custom.id);
  const deleteAudit = await client.query(`select details from audit_events where organization_id=$1 and action='presentation.theme.deleted' and entity_id=$2`, [orgA,custom.id]);
  assert.equal(deleteAudit.rowCount,1);

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
  console.log(JSON.stringify({ ok:true, mode:"postgres", builtins:9, tenantScoped:true, crossTenantBlocked:true, deleteFallback:true, rbac:true, builtinsImmutable:true, audited:true }));
} finally {
  await client.end();
}
