import assert from "node:assert/strict";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const requiredTables = [
  "subscription_plans",
  "organization_subscriptions",
  "product_keys",
  "product_activations",
  "entitlement_leases",
  "product_activation_attempts"
];

async function tableExists(name) {
  const result = await client.query("select to_regclass($1)::text as table_name", [`public.${name}`]);
  return result.rows[0]?.table_name === name;
}

async function columns(table) {
  const result = await client.query(
    `select column_name,data_type,is_nullable
     from information_schema.columns
     where table_schema='public' and table_name=$1
     order by ordinal_position`,
    [table]
  );
  return result.rows;
}

async function constraintDefinitions(table) {
  const result = await client.query(
    `select c.contype,pg_get_constraintdef(c.oid) as definition
     from pg_constraint c
     join pg_class t on t.oid=c.conrelid
     join pg_namespace n on n.oid=t.relnamespace
     where n.nspname='public' and t.relname=$1`,
    [table]
  );
  return result.rows;
}

async function indexNames(table) {
  const result = await client.query(
    `select indexname,indexdef
     from pg_indexes
     where schemaname='public' and tablename=$1`,
    [table]
  );
  return new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
}

try {
  for (const table of requiredTables) {
    assert.equal(await tableExists(table), true, `${table} must exist`);
  }

  const subscriptionConstraints = await constraintDefinitions("organization_subscriptions");
  const subscriptionChecks = subscriptionConstraints.map((row) => row.definition).join("\n");
  for (const status of ["trial", "active", "past_due", "suspended", "expired", "cancelled"]) {
    assert.match(subscriptionChecks, new RegExp(`'${status}'`), `subscription status ${status} must be constrained`);
  }
  assert.ok(subscriptionConstraints.some((row) => row.contype === "f" && /organizations/i.test(row.definition)), "subscriptions must reference organizations");

  const keyColumns = await columns("product_keys");
  const keyColumnNames = new Set(keyColumns.map((row) => row.column_name));
  for (const forbidden of ["display_key", "normalized_key", "product_key", "plaintext_key", "key_plaintext"]) {
    assert.equal(keyColumnNames.has(forbidden), false, `product_keys must not store ${forbidden}`);
  }
  for (const required of ["key_prefix", "key_salt", "key_hash", "status", "activation_limit", "issued_by", "note", "batch_reference"]) {
    assert.equal(keyColumnNames.has(required), true, `product_keys.${required} must exist`);
  }
  assert.equal(keyColumns.find((row) => row.column_name === "key_salt")?.data_type, "bytea");
  assert.equal(keyColumns.find((row) => row.column_name === "key_hash")?.data_type, "bytea");

  const activationColumns = await columns("product_activations");
  assert.equal(activationColumns.find((row) => row.column_name === "edge_device_id")?.is_nullable, "YES", "Edge link must remain nullable until pairing");
  const activationConstraints = await constraintDefinitions("product_activations");
  assert.ok(activationConstraints.some((row) => row.contype === "f" && /edge_devices/i.test(row.definition)), "activations must link to existing Edge identity");
  assert.ok(activationConstraints.some((row) => row.contype === "u" && /organization_id, installation_id/i.test(row.definition)), "same installation must be unique per organization");

  const leaseColumns = new Set((await columns("entitlement_leases")).map((row) => row.column_name));
  for (const required of ["entitlement_id", "signing_key_id", "online_valid_until", "offline_grace_until", "revoked_at", "revoked_by", "revocation_reason"]) {
    assert.equal(leaseColumns.has(required), true, `entitlement_leases.${required} must exist`);
  }

  const orgScoped = ["organization_subscriptions", "product_keys", "product_activations", "entitlement_leases", "product_activation_attempts"];
  for (const table of orgScoped) {
    const constraints = await constraintDefinitions(table);
    assert.ok(constraints.some((row) => row.contype === "f" && /organizations/i.test(row.definition)), `${table} must reference organizations`);
  }

  const expectedIndexes = new Map([
    ["organization_subscriptions", ["idx_organization_subscriptions_org_status", "uq_organization_subscriptions_current"]],
    ["product_keys", ["idx_product_keys_org_status", "uq_product_keys_prefix"]],
    ["product_activations", ["idx_product_activations_org_state", "idx_product_activations_installation", "uq_product_activations_active_edge"]],
    ["entitlement_leases", ["idx_entitlement_leases_active"]],
    ["product_activation_attempts", ["idx_product_activation_attempts_prefix_time", "idx_product_activation_attempts_installation_time", "idx_product_activation_attempts_ip_time"]]
  ]);
  for (const [table, names] of expectedIndexes) {
    const indexes = await indexNames(table);
    for (const name of names) assert.equal(indexes.has(name), true, `${name} must exist`);
  }

  console.log(JSON.stringify({ ok: true, commercialTables: requiredTables.length, plaintextProductKeyStored: false, edgePairingPreserved: true }));
} finally {
  await client.end();
}
