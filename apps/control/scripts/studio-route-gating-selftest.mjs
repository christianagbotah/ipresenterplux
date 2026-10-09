#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { isStudioRouteActive, studioRoutes, visibleStudioRoutes } from "../src/components/navigation/studio-routes.ts";

const currentService = await import("../src/lib/current-service.ts");
assert.equal(typeof currentService.getCurrentServiceForUser, "function");
assert.equal(typeof currentService.resolveStudioNavigationCapabilities, "function");

const expectedRouteCapabilities = new Map([
  ["/media", "canMedia"],
  ["/cameras", "canCameras"],
  ["/ai-director", "canAIDirector"],
  ["/translations", "canTranslations"],
  ["/streaming", "canStreaming"],
  ["/archive", "canArchive"],
  ["/settings", "canSettings"]
]);
for (const [href, capability] of expectedRouteCapabilities) {
  const route = studioRoutes.find((candidate) => candidate.href === href);
  assert.ok(route, `${href} route must exist`);
  assert.equal(route.capability, capability, `${href} must use ${capability}`);
}
assert.equal(isStudioRouteActive("/archive/00000000-0000-4000-8000-000000000001", "/archive"), true);

for (const relative of [
  "../src/app/media/page.tsx",
  "../src/app/cameras/page.tsx",
  "../src/app/ai-director/page.tsx",
  "../src/app/archive/page.tsx"
]) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  assert.match(source, /getCurrentServiceForUser/, `${relative} must use shared current-service context`);
}
for (const relative of ["../src/app/DashboardPage.tsx", "../src/app/operator/page.tsx"]) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  assert.match(source, /getCockpitViewModel/, `${relative} must use the authoritative Cockpit projection`);
}
const cockpitViewModelSource = await readFile(new URL("../src/lib/cockpit/view-model.ts", import.meta.url), "utf8");
assert.match(cockpitViewModelSource, /getCurrentServiceForUser/, "Cockpit projection must delegate service selection to the shared current-service context");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({
    ok: true,
    mode: "local-contract",
    database: "deferred-to-ci",
    nestedArchiveActive: true,
    routeCapabilities: Object.fromEntries(expectedRouteCapabilities)
  }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const fullOrg = randomUUID();
const emptyOrg = randomUUID();
const noServiceOrg = randomUUID();
const fullCampus = randomUUID();
const emptyCampus = randomUUID();
const noServiceCampus = randomUUID();
const owner = randomUUID();
const viewer = randomUUID();
const mediaOperator = randomUUID();
const noServiceUser = randomUUID();
const liveService = randomUUID();
const readyService = randomUUID();
const draftService = randomUUID();
const emptyReadyService = randomUUID();
const fullPlan = randomUUID();
const emptyPlan = randomUUID();
const fullSubscription = randomUUID();
const emptySubscription = randomUUID();
const now = new Date("2099-01-01T12:00:00.000Z");

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone) values
      ($1,'Full Studio Church',$2,'GH','Africa/Accra'),
      ($3,'Unentitled Studio Church',$4,'GH','Africa/Accra'),
      ($5,'No Service Studio Church',$6,'GH','Africa/Accra')`,
    [fullOrg, `studio-full-${fullOrg}`, emptyOrg, `studio-empty-${emptyOrg}`, noServiceOrg, `studio-none-${noServiceOrg}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code) values
      ($1,$2,'Full Campus','full','Accra','GH'),
      ($3,$4,'Empty Campus','empty','Accra','GH'),
      ($5,$6,'No Service Campus','none','Accra','GH')`,
    [fullCampus, fullOrg, emptyCampus, emptyOrg, noServiceCampus, noServiceOrg]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values
      ($1,$2,'Studio Owner','active'),
      ($3,$4,'Studio Viewer','active'),
      ($5,$6,'Unentitled Media Operator','active'),
      ($7,$8,'No Service Viewer','active')`,
    [
      owner, `studio-owner-${owner}@example.invalid`,
      viewer, `studio-viewer-${viewer}@example.invalid`,
      mediaOperator, `studio-media-${mediaOperator}@example.invalid`,
      noServiceUser, `studio-none-${noServiceUser}@example.invalid`
    ]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values
      ($1,$2,'owner'),($3,$2,'viewer'),($4,$5,'media_operator'),($6,$7,'viewer')`,
    [owner, fullOrg, viewer, mediaOperator, emptyOrg, noServiceUser, noServiceOrg]
  );
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,updated_at) values
      ($1,$2,$3,'Older Live Service','live','2098-12-31T09:00:00Z','2098-12-31T09:05:00Z','WEBP','2098-12-31T09:05:00Z'),
      ($4,$2,$3,'Newer Ready Service','ready','2099-01-02T09:00:00Z',null,'WEBP','2099-01-01T11:50:00Z'),
      ($5,$2,$3,'Newest Draft','draft','2099-01-03T09:00:00Z',null,'WEBP','2099-01-01T11:59:00Z'),
      ($6,$7,$8,'Unentitled Ready','ready','2099-01-02T10:00:00Z',null,'WEBP','2099-01-01T11:55:00Z')`,
    [liveService, fullOrg, fullCampus, readyService, draftService, emptyReadyService, emptyOrg, emptyCampus]
  );
  await client.query(
    `insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits) values
      ($1,$2,'Full Studio Plan',true,'custom',5,$3::jsonb,'{}'::jsonb),
      ($4,$5,'Empty Studio Plan',true,'custom',5,'{}'::jsonb,'{}'::jsonb)`,
    [
      fullPlan,
      `studio-full-${fullPlan}`,
      JSON.stringify({
        "core.presentation": true,
        "ai.director": true,
        "translations.text": true,
        "translations.audio": true,
        "streaming.web": true,
        "streaming.social": true
      }),
      emptyPlan,
      `studio-empty-${emptyPlan}`
    ]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until) values
      ($1,$2,$3,'active','2098-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z'),
      ($4,$5,$6,'active','2098-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z')`,
    [fullSubscription, fullOrg, fullPlan, emptySubscription, emptyOrg, emptyPlan]
  );

  const ownerContext = await currentService.getCurrentServiceForUser(owner, { client, organizationId: fullOrg, now });
  assert.ok(ownerContext);
  assert.equal(ownerContext.organizationId, fullOrg);
  assert.equal(ownerContext.service?.id, liveService, "live service must outrank newer ready/draft services");
  assert.deepEqual(ownerContext.roles, ["owner"]);
  assert.equal(ownerContext.capabilities.canMedia, true);
  assert.equal(ownerContext.capabilities.canCameras, true);
  assert.equal(ownerContext.capabilities.canAIDirector, true);
  assert.equal(ownerContext.capabilities.canTranslations, true);
  assert.equal(ownerContext.capabilities.canStreaming, true);
  assert.equal(ownerContext.capabilities.canArchive, true);
  assert.equal(ownerContext.capabilities.canSettings, true);
  const ownerRoutes = visibleStudioRoutes(ownerContext.capabilities).map((route) => route.href);
  for (const href of ["/media", "/cameras", "/ai-director", "/translations", "/streaming", "/archive", "/settings"]) {
    assert.ok(ownerRoutes.includes(href), `owner route ${href} should be visible`);
  }

  const viewerContext = await currentService.getCurrentServiceForUser(viewer, { client, organizationId: fullOrg, now });
  assert.ok(viewerContext);
  assert.equal(viewerContext.capabilities.canMedia, true, "entitled planner viewer may browse Media");
  assert.equal(viewerContext.capabilities.canCameras, true, "entitled planner viewer may inspect camera truth");
  assert.equal(viewerContext.capabilities.canAIDirector, false, "entitled but unauthorized viewer must not see AI Director");
  assert.equal(viewerContext.capabilities.canStreaming, false, "entitled but unauthorized viewer must not see Streaming");
  assert.equal(viewerContext.capabilities.canTranslations, false, "entitled but unauthorized viewer must not see Translations");
  assert.equal(viewerContext.capabilities.canArchive, true);
  assert.equal(viewerContext.capabilities.canSettings, false);

  const unentitledContext = await currentService.getCurrentServiceForUser(mediaOperator, { client, organizationId: emptyOrg, now });
  assert.ok(unentitledContext);
  assert.equal(unentitledContext.service?.id, emptyReadyService);
  assert.equal(unentitledContext.capabilities.canMedia, false, "authorized but unentitled Media must be hidden");
  assert.equal(unentitledContext.capabilities.canCameras, false, "authorized but unentitled Cameras must be hidden");
  assert.equal(unentitledContext.capabilities.canAIDirector, false, "authorized but unentitled AI Director must be hidden");
  assert.equal(unentitledContext.capabilities.canStreaming, false, "authorized but unentitled Streaming must be hidden");
  assert.equal(unentitledContext.capabilities.canArchive, true, "Archive metadata remains visible after entitlement loss");
  const unentitledRoutes = visibleStudioRoutes(unentitledContext.capabilities).map((route) => route.href);
  for (const href of ["/media", "/cameras", "/ai-director", "/streaming"]) {
    assert.equal(unentitledRoutes.includes(href), false, `${href} must be hidden without entitlement`);
  }
  assert.equal(unentitledRoutes.includes("/archive"), true);

  const noServiceContext = await currentService.getCurrentServiceForUser(noServiceUser, { client, organizationId: noServiceOrg, now });
  assert.ok(noServiceContext, "membership context must survive without a ready/live service");
  assert.equal(noServiceContext.service, null);
  assert.equal(noServiceContext.capabilities.canArchive, true);

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    currentServiceOrdering: "live -> ready -> newest",
    entitledButUnauthorized: true,
    authorizedButUnentitled: true,
    archiveMetadataSurvivesExpiry: true,
    noServiceMembershipContext: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
