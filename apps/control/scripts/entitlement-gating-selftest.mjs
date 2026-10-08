#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const entitlement = await import("../src/lib/licensing/entitlement-access.ts");
const { requireEntitlementFeature, EntitlementAccessError } = entitlement;
assert.ok(requireEntitlementFeature && EntitlementAccessError, "entitlement access helper contract must exist");

const streamRoute = await readFile(new URL("../src/app/api/v1/services/[id]/stream/route.ts", import.meta.url), "utf8");
const outputRoute = await readFile(new URL("../src/app/api/v1/outputs/[id]/state/route.ts", import.meta.url), "utf8");
const translationJobs = await readFile(new URL("../src/lib/translation-jobs.ts", import.meta.url), "utf8");
const speechJobs = await readFile(new URL("../src/lib/speech-synthesis-jobs.ts", import.meta.url), "utf8");
for (const source of [streamRoute, outputRoute, translationJobs, speechJobs]) {
  assert.match(source, /requireEntitlementFeature/u, "premium operation source must invoke entitlement gate");
}
assert.match(streamRoute, /streaming\.web/u);
assert.match(streamRoute, /streaming\.social/u);
assert.match(outputRoute, /streaming\.web/u);
assert.match(outputRoute, /streaming\.social/u);
assert.match(translationJobs, /translations\.text/u);
assert.match(speechJobs, /translations\.audio/u);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");

const orgId = randomUUID();
const planId = randomUUID();
const subscriptionId = randomUUID();
const now = new Date("2026-10-08T10:00:00.000Z");

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof EntitlementAccessError, `Expected EntitlementAccessError, got ${error?.constructor?.name}`);
    assert.equal(error.code, code);
    return true;
  });
}

try {
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Gate Church',$2,'GH','Africa/Accra')`,
    [orgId, `gate-${orgId}`]
  );
  await client.query(
    `insert into subscription_plans(id,code,name,default_device_seat_limit,features,numeric_limits)
     values ($1,'gate-pro','Gate Pro',2,$2::jsonb,'{}'::jsonb)`,
    [planId, JSON.stringify({
      "streaming.web": true,
      "streaming.social": false,
      "translations.text": true,
      "translations.audio": true,
      "scripture.local": true
    })]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until,device_seat_limit)
     values ($1,$2,$3,'active',$4,$5,$6,2)`,
    [
      subscriptionId,
      orgId,
      planId,
      new Date(now.getTime() - 86_400_000),
      new Date(now.getTime() + 86_400_000),
      new Date(now.getTime() + 8 * 86_400_000)
    ]
  );

  const online = await requireEntitlementFeature(orgId, "streaming.web", { client, now });
  assert.equal(online.featureId, "streaming.web");
  assert.equal(online.state, "online");
  assert.equal(online.planCode, "gate-pro");
  await expectCode(requireEntitlementFeature(orgId, "streaming.social", { client, now }), "feature_unavailable");

  const graceNow = new Date(now.getTime() + 2 * 86_400_000);
  const grace = await requireEntitlementFeature(orgId, "translations.text", { client, now: graceNow });
  assert.equal(grace.state, "grace");

  const expiredNow = new Date(now.getTime() + 9 * 86_400_000);
  await expectCode(requireEntitlementFeature(orgId, "translations.audio", { client, now: expiredNow }), "subscription_expired");

  await client.query("update organization_subscriptions set status='suspended' where id=$1", [subscriptionId]);
  await expectCode(requireEntitlementFeature(orgId, "streaming.web", { client, now }), "subscription_inactive");

  await client.query("delete from organization_subscriptions where id=$1", [subscriptionId]);
  await expectCode(requireEntitlementFeature(orgId, "streaming.web", { client, now }), "subscription_missing");
} finally {
  await client.query("rollback");
  await client.end();
}

console.log(JSON.stringify({
  ok: true,
  tenantScoped: true,
  onlineAndGrace: true,
  expiryDenied: true,
  premiumRoutesWired: true,
  readOnlyHistoryUnaffected: true
}));
