#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { isProductAdminEmail, requireProductAdminEmail } from "../src/lib/licensing/product-admin.ts";
import {
  issueProductKeyForSubscription,
  listProductKeysForOrganization,
  resetProductKey,
  revokeProductKey,
  setSubscriptionStatus,
  getOrganizationSubscriptionOverview,
  deactivateOrganizationActivation,
  listLicensingAudit,
  LicensingAdminError
} from "../src/lib/licensing/licensing-admin-service.ts";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const allowlist = "licensing@lightworldtech.com, OWNER@LIGHTWORLDTECH.COM";
assert.equal(isProductAdminEmail("owner@lightworldtech.com", allowlist), true);
assert.equal(isProductAdminEmail("LICENSING@LIGHTWORLDTECH.COM", allowlist), true);
assert.equal(isProductAdminEmail("church.owner@example.test", allowlist), false, "organization owners are not automatically Lightworld product admins");
assert.doesNotThrow(() => requireProductAdminEmail("owner@lightworldtech.com", allowlist));
assert.throws(() => requireProductAdminEmail("church.owner@example.test", allowlist), /product administrator/iu);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");

const orgA = randomUUID();
const orgB = randomUUID();
const actorId = randomUUID();
const planId = randomUUID();
const subA = randomUUID();
const subB = randomUUID();
const now = new Date("2026-10-08T09:15:00.000Z");

async function expectAdminCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof LicensingAdminError);
    assert.equal(error.code, code);
    return true;
  });
}

try {
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Tenant A',$2,'GH','Africa/Accra'),($3,'Tenant B',$4,'GH','Africa/Accra')`,
    [orgA, `tenant-a-${orgA}`, orgB, `tenant-b-${orgB}`]
  );
  await client.query(
    `insert into users(id,email,display_name,status)
     values ($1,'owner@lightworldtech.com','Product Admin','active')`,
    [actorId]
  );
  await client.query(
    `insert into subscription_plans(id,code,name,default_device_seat_limit,features,numeric_limits)
     values ($1,'admin-test','Admin Test',2,$2::jsonb,$3::jsonb)`,
    [planId, JSON.stringify({ "core.presentation": true }), JSON.stringify({ deviceSeats: 2 })]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,device_seat_limit)
     values ($1,$2,$3,'active',$6,$7,2),($4,$5,$3,'active',$6,$7,1)`,
    [subA, orgA, planId, subB, orgB, now, new Date(now.getTime() + 30 * 86_400_000)]
  );

  const issued = await issueProductKeyForSubscription(client, {
    subscriptionId: subA,
    actorUserId: actorId,
    activationLimit: 2,
    note: "Sanctuary licences"
  }, { now });
  assert.match(issued.displayKey, /^IPLX-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/u);
  assert.ok(issued.id);
  assert.ok(issued.prefix);

  const stored = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='product_keys' and column_name in ('display_key','product_key','plaintext_key','full_key')`
  );
  assert.equal(stored.rowCount, 0, "plaintext key columns must not exist");

  const listed = await listProductKeysForOrganization(client, orgA);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, issued.id);
  assert.equal(listed[0].prefix, issued.prefix);
  assert.equal("displayKey" in listed[0], false, "full key must not reappear after issuance");
  assert.equal(JSON.stringify(listed).includes(issued.displayKey), false);

  const reset = await resetProductKey(client, {
    productKeyId: issued.id,
    actorUserId: actorId
  }, { now: new Date(now.getTime() + 60_000) });
  assert.notEqual(reset.displayKey, issued.displayKey);
  assert.notEqual(reset.id, issued.id);
  const afterReset = await listProductKeysForOrganization(client, orgA);
  const original = afterReset.find((item) => item.id === issued.id);
  const replacement = afterReset.find((item) => item.id === reset.id);
  assert.equal(original?.status, "revoked");
  assert.equal(replacement?.status, "active");
  assert.equal(JSON.stringify(afterReset).includes(reset.displayKey), false, "reset plaintext must also be one-time only");

  const activationId = randomUUID();
  await client.query(
    `insert into product_activations
      (id,organization_id,subscription_id,product_key_id,installation_id,platform,app_version,device_name,
       activation_token_salt,activation_token_hash,state,activated_at,last_validated_at)
     values ($1,$2,$3,$4,$5,'windows','1.0.0','Tenant A PC',$6,$7,'active',$8,$8)`,
    [activationId, orgA, subA, reset.id, `install-${randomUUID()}`, Buffer.alloc(16, 1), Buffer.alloc(32, 2), now]
  );

  const overviewA = await getOrganizationSubscriptionOverview(client, orgA);
  assert.equal(overviewA.organizationId, orgA);
  assert.equal(overviewA.subscription.id, subA);
  assert.equal(overviewA.seats.limit, 2);
  assert.equal(overviewA.seats.used, 1);
  assert.equal(overviewA.activations.length, 1);
  assert.equal(overviewA.activations[0].id, activationId);

  const overviewB = await getOrganizationSubscriptionOverview(client, orgB);
  assert.equal(overviewB.organizationId, orgB);
  assert.equal(overviewB.seats.used, 0);
  assert.equal(overviewB.activations.length, 0, "church subscription overview must not leak another tenant's devices");

  await expectAdminCode(
    deactivateOrganizationActivation(client, {
      organizationId: orgB,
      activationId,
      actorUserId: actorId,
      reason: "tenant mismatch probe"
    }, { now: new Date(now.getTime() + 120_000) }),
    "tenant_mismatch"
  );
  await deactivateOrganizationActivation(client, {
    organizationId: orgA,
    activationId,
    actorUserId: actorId,
    reason: "device retired"
  }, { now: new Date(now.getTime() + 120_000) });
  const deactivated = await client.query("select state from product_activations where id=$1", [activationId]);
  assert.equal(deactivated.rows[0].state, "deactivated");

  await setSubscriptionStatus(client, {
    subscriptionId: subA,
    status: "suspended",
    actorUserId: actorId,
    reason: "billing hold"
  }, { now: new Date(now.getTime() + 180_000) });
  const suspended = await client.query("select status from organization_subscriptions where id=$1", [subA]);
  assert.equal(suspended.rows[0].status, "suspended");

  await revokeProductKey(client, {
    productKeyId: reset.id,
    actorUserId: actorId,
    reason: "security rotation"
  }, { now: new Date(now.getTime() + 240_000) });
  const revoked = await client.query("select status from product_keys where id=$1", [reset.id]);
  assert.equal(revoked.rows[0].status, "revoked");

  const audit = await listLicensingAudit(client, orgA);
  const actions = new Set(audit.map((event) => event.action));
  for (const action of [
    "licensing.product_key.issued",
    "licensing.product_key.reset",
    "licensing.activation.deactivated",
    "licensing.subscription.status_changed",
    "licensing.product_key.revoked"
  ]) assert.equal(actions.has(action), true, `missing licensing audit action ${action}`);

  const files = {
    settingsPage: await readFile(new URL("../src/app/settings/subscription/page.tsx", import.meta.url), "utf8"),
    settingsRoot: await readFile(new URL("../src/app/settings/page.tsx", import.meta.url), "utf8"),
    adminPage: await readFile(new URL("../src/app/admin/licensing/page.tsx", import.meta.url), "utf8"),
    keysRoute: await readFile(new URL("../src/app/api/v1/admin/licensing/keys/route.ts", import.meta.url), "utf8"),
    subscriptionsRoute: await readFile(new URL("../src/app/api/v1/admin/licensing/subscriptions/route.ts", import.meta.url), "utf8"),
    statusComponent: await readFile(new URL("../src/components/licensing/SubscriptionStatus.tsx", import.meta.url), "utf8"),
    adminComponent: await readFile(new URL("../src/components/licensing/LicensingAdmin.tsx", import.meta.url), "utf8")
  };
  assert.match(files.settingsRoot, /\/settings\/subscription/u, "Settings must expose Subscription");
  assert.match(files.settingsPage, /DEVICE_ADMIN_ROLES/u, "church subscription management must remain owner/admin gated");
  assert.match(files.settingsPage, /organization_id=\$1/u, "church status must be tenant scoped");
  assert.match(files.adminPage, /requireProductAdminEmail/u, "commercial admin page must require Lightworld product-admin authorization");
  for (const route of [files.keysRoute, files.subscriptionsRoute]) {
    assert.match(route, /auth\(\)/u);
    assert.match(route, /requireProductAdminEmail/u);
    assert.match(route, /no-store/iu);
  }
  assert.match(files.keysRoute, /displayKey/u, "issue/reset response may return plaintext once");
  assert.match(files.keysRoute, /listProductKeysForOrganization/u, "key lists must use prefix-only service output");
  assert.doesNotMatch(files.adminPage, /IPLX-[A-Z2-9]{4}/u, "full product keys must never be server-rendered into admin HTML");
  assert.match(files.statusComponent, /seat/iu);
  assert.match(files.adminComponent, /issue/iu);

  console.log(JSON.stringify({
    ok: true,
    productAdminSeparated: true,
    plaintextKeyOneTimeOnly: true,
    tenantIsolation: true,
    seatCounts: true,
    revokeAndDeactivate: true,
    auditVisible: true
  }));
} finally {
  await client.query("rollback");
  await client.end();
}
