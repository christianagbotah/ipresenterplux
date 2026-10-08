#!/usr/bin/env node
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { generateProductKey } from "../src/lib/licensing/product-keys.ts";
import { verifyEntitlementEnvelope } from "../src/lib/licensing/entitlement.ts";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const activation = await import("../src/lib/licensing/activation-service.ts");
const { activateProduct, renewProductActivation, linkActivationToEdge, ActivationServiceError } = activation;
assert.ok(activateProduct && renewProductActivation && linkActivationToEdge && ActivationServiceError, "activation service contract must exist");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
process.env.IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID = "activation-test-k1";
process.env.IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");

const orgId = randomUUID();
const otherOrgId = randomUUID();
const planId = randomUUID();
const subscriptionId = randomUUID();
const productKeyId = randomUUID();
const installationId = `install-${randomUUID()}`;
const now = new Date("2026-10-08T08:00:00.000Z");
const key = await generateProductKey();

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ActivationServiceError, `Expected ActivationServiceError, got ${error?.constructor?.name}`);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /IPLX-|activationToken|productKey/iu, "errors must not leak secrets");
    return true;
  });
}

try {
  for (const [id, slug] of [[orgId, `activation-${orgId}`], [otherOrgId, `activation-other-${otherOrgId}`]]) {
    await client.query(
      `insert into organizations(id,name,slug,country_code,timezone) values ($1,$2,$3,'GH','Africa/Accra')`,
      [id, id === orgId ? "Activation Church" : "Other Church", slug]
    );
  }
  await client.query(
    `insert into subscription_plans(id,code,name,default_device_seat_limit,features,numeric_limits)
     values ($1,'church-pro','Church Pro',2,$2::jsonb,$3::jsonb)`,
    [planId, JSON.stringify({ "core.presentation": true, "scripture.local": true, "streaming.web": true }), JSON.stringify({ translationChannels: 3 })]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,device_seat_limit)
     values ($1,$2,$3,'active',$4,$5,2)`,
    [subscriptionId, orgId, planId, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 30 * 86_400_000)]
  );
  await client.query(
    `insert into product_keys(id,organization_id,subscription_id,key_prefix,key_salt,key_hash,status,activation_limit,valid_until)
     values ($1,$2,$3,$4,$5,$6,'active',5,$7)`,
    [productKeyId, orgId, subscriptionId, key.prefix, key.salt, key.hash, new Date(now.getTime() + 30 * 86_400_000)]
  );

  const request = {
    productKey: key.displayKey,
    installationId,
    platform: "windows",
    appVersion: "1.0.0-test",
    deviceName: "Sanctuary PC"
  };
  const first = await activateProduct(client, request, { sourceIp: "127.0.0.1", now });
  assert.match(first.activationId, /^[0-9a-f-]{36}$/iu);
  assert.ok(first.activationToken.length >= 32);
  assert.equal(first.organization.id, orgId);
  assert.equal(first.organization.name, "Activation Church");
  assert.equal(first.pairingRequired, true);
  const firstEntitlement = verifyEntitlementEnvelope(first.entitlement, { "activation-test-k1": publicPem });
  assert.equal(firstEntitlement.organizationId, orgId);
  assert.equal(firstEntitlement.activationId, first.activationId);
  assert.equal(firstEntitlement.installationId, installationId);
  assert.equal(firstEntitlement.features["streaming.web"], true);
  assert.equal(firstEntitlement.limits.translationChannels, 3);

  const stored = await client.query(
    `select octet_length(activation_token_hash)::int as hash_bytes,
            octet_length(activation_token_salt)::int as salt_bytes,
            state,last_entitlement_id::text
     from product_activations where id=$1::uuid`,
    [first.activationId]
  );
  assert.equal(stored.rows[0].hash_bytes, 32);
  assert.equal(stored.rows[0].salt_bytes, 16);
  assert.equal(stored.rows[0].state, "active");
  assert.equal(stored.rows[0].last_entitlement_id, firstEntitlement.entitlementId);
  const leases = await client.query("select count(*)::int as count from entitlement_leases where activation_id=$1::uuid", [first.activationId]);
  assert.equal(leases.rows[0].count, 1);

  const second = await activateProduct(client, request, { sourceIp: "127.0.0.1", now: new Date(now.getTime() + 60_000) });
  assert.equal(second.activationId, first.activationId, "same installation must reuse its activation identity");
  assert.notEqual(second.activationToken, first.activationToken, "reactivation may rotate the bootstrap token without consuming another seat");
  const activationCount = await client.query("select count(*)::int as count from product_activations where organization_id=$1", [orgId]);
  assert.equal(activationCount.rows[0].count, 1);

  const secondPayload = verifyEntitlementEnvelope(second.entitlement, { "activation-test-k1": publicPem });
  const renewed = await renewProductActivation(client, {
    activationId: second.activationId,
    installationId,
    activationToken: second.activationToken,
    currentEntitlementId: secondPayload.entitlementId
  }, { now: new Date(now.getTime() + 120_000) });
  const renewedPayload = verifyEntitlementEnvelope(renewed.entitlement, { "activation-test-k1": publicPem });
  assert.equal(renewed.activationId, second.activationId);
  assert.notEqual(renewedPayload.entitlementId, secondPayload.entitlementId);

  const ownEdgeId = randomUUID();
  const otherEdgeId = randomUUID();
  await client.query(
    `insert into edge_devices(id,organization_id,name,platform,status,last_seen_at)
     values ($1,$2,'Activation Edge','windows','active',now()),($3,$4,'Foreign Edge','windows','active',now())`,
    [ownEdgeId, orgId, otherEdgeId, otherOrgId]
  );
  await expectCode(linkActivationToEdge(client, {
    activationId: second.activationId,
    installationId,
    organizationId: otherOrgId,
    edgeDeviceId: otherEdgeId
  }), "organization_mismatch");
  const linked = await linkActivationToEdge(client, {
    activationId: second.activationId,
    installationId,
    organizationId: orgId,
    edgeDeviceId: ownEdgeId
  });
  assert.equal(linked.edgeDeviceId, ownEdgeId);

  const badKey = `${key.displayKey.slice(0, -1)}${key.displayKey.endsWith("A") ? "B" : "A"}`;
  await expectCode(activateProduct(client, { ...request, productKey: badKey, installationId: `install-${randomUUID()}` }, { sourceIp: "127.0.0.3", now }), "invalid_key");

  await client.query("update product_keys set status='revoked',revoked_at=$2 where id=$1", [productKeyId, now]);
  await expectCode(activateProduct(client, { ...request, installationId: `install-${randomUUID()}` }, { sourceIp: "127.0.0.4", now }), "key_inactive");
  await client.query("update product_keys set status='active',revoked_at=null,valid_until=$2 where id=$1", [productKeyId, new Date(now.getTime() - 1)]);
  await expectCode(activateProduct(client, { ...request, installationId: `install-${randomUUID()}` }, { sourceIp: "127.0.0.5", now }), "key_inactive");
  await client.query("update product_keys set valid_until=$2 where id=$1", [productKeyId, new Date(now.getTime() + 30 * 86_400_000)]);

  await client.query("update organization_subscriptions set status='suspended' where id=$1", [subscriptionId]);
  await expectCode(activateProduct(client, { ...request, installationId: `install-${randomUUID()}` }, { sourceIp: "127.0.0.6", now }), "subscription_inactive");
  await client.query("update organization_subscriptions set status='active',device_seat_limit=1 where id=$1", [subscriptionId]);
  await expectCode(activateProduct(client, { ...request, installationId: `install-${randomUUID()}` }, { sourceIp: "127.0.0.7", now }), "seat_limit");
  await client.query("update organization_subscriptions set device_seat_limit=2 where id=$1", [subscriptionId]);

  const limitedInstallation = `install-${randomUUID()}`;
  for (let i = 0; i < 10; i += 1) {
    await client.query(
      `insert into product_activation_attempts(key_prefix,installation_id,source_ip,outcome,occurred_at)
       values ($1,$2,'127.0.0.8','invalid_key',$3)`,
      [key.prefix, limitedInstallation, new Date(now.getTime() - i * 1_000)]
    );
  }
  await expectCode(activateProduct(client, { ...request, installationId: limitedInstallation }, { sourceIp: "127.0.0.8", now }), "rate_limited");

  await client.query("update product_activations set state='deactivated',deactivated_at=$2 where id=$1", [second.activationId, now]);
  await expectCode(renewProductActivation(client, {
    activationId: second.activationId,
    installationId,
    activationToken: second.activationToken,
    currentEntitlementId: renewedPayload.entitlementId
  }, { now: new Date(now.getTime() + 180_000) }), "activation_inactive");

  const audit = await client.query(
    `select outcome,count(*)::int as count from product_activation_attempts
     where organization_id=$1 or installation_id=$2
     group by outcome`,
    [orgId, installationId]
  );
  const outcomes = new Map(audit.rows.map((row) => [row.outcome, row.count]));
  assert.ok((outcomes.get("success") ?? 0) >= 2, "successful activation/reactivation must be audited");
  assert.ok((outcomes.get("invalid_key") ?? 0) >= 1, "invalid key must be audited");
  assert.ok((outcomes.get("seat_limit") ?? 0) >= 1, "seat rejection must be audited");

  const activateRoute = await readFile(new URL("../src/app/api/v1/licensing/activate/route.ts", import.meta.url), "utf8");
  const renewRoute = await readFile(new URL("../src/app/api/v1/licensing/renew/route.ts", import.meta.url), "utf8");
  const linkRoute = await readFile(new URL("../src/app/api/v1/licensing/link-device/route.ts", import.meta.url), "utf8");
  for (const source of [activateRoute, renewRoute, linkRoute]) assert.match(source, /no-store/iu, "licensing responses must be no-store");
  assert.match(linkRoute, /authenticateEdgeDevice/iu, "device linking must use existing Edge identity authentication");
  assert.match(linkRoute, /organizationId:\s*device\.organizationId/iu, "linking must scope activation to authenticated Edge organization");
  assert.doesNotMatch(`${activateRoute}\n${renewRoute}\n${linkRoute}`, /console\.(?:log|info|debug).*?(?:productKey|activationToken)/iu, "routes must not log activation secrets");

  console.log(JSON.stringify({
    ok: true,
    activationIdempotent: true,
    renewal: true,
    seatLimit: true,
    rateLimit: true,
    crossOrganizationLinkBlocked: true,
    auditRows: true,
    pairingIdentityPreserved: true
  }));
} finally {
  await client.query("rollback");
  await client.end();
}
