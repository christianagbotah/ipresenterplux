import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { normalizeProductKey, verifyProductKey } from "./product-keys.ts";
import { signEntitlement, type EntitlementPayload } from "./entitlement.ts";
import { offlineGraceUntilFor } from "./entitlement-policy.ts";

type QueryClient = Pick<PoolClient, "query">;

export type ActivationRequest = {
  productKey: string;
  installationId: string;
  platform: string;
  appVersion: string;
  deviceName: string;
};

export type RenewalRequest = {
  activationId: string;
  installationId: string;
  activationToken: string;
  currentEntitlementId: string;
};

export type ActivationContext = {
  sourceIp?: string | null;
  now?: Date;
};

export type ActivationErrorCode =
  | "invalid_key"
  | "key_inactive"
  | "subscription_inactive"
  | "seat_limit"
  | "rate_limited"
  | "activation_inactive"
  | "invalid_token"
  | "organization_mismatch"
  | "not_found";

export class ActivationServiceError extends Error {
  constructor(public readonly code: ActivationErrorCode, message = "Activation could not be completed") {
    super(message);
    this.name = "ActivationServiceError";
  }
}

type LicenseRow = {
  product_key_id: string;
  organization_id: string;
  subscription_id: string;
  key_salt: Buffer;
  key_hash: Buffer;
  key_status: string;
  activation_limit: number;
  valid_until: Date | string | null;
  subscription_status: string;
  expires_at: Date | string | null;
  grace_until: Date | string | null;
  device_seat_limit: number | null;
  plan_code: string;
  plan_enabled: boolean;
  default_device_seat_limit: number;
  features: Record<string, boolean>;
  numeric_limits: Record<string, number>;
  organization_name: string;
};

type ActivationRow = {
  id: string;
  organization_id: string;
  subscription_id: string;
  product_key_id: string;
  installation_id: string;
  state: string;
  activation_token_salt: Buffer;
  activation_token_hash: Buffer;
  edge_device_id: string | null;
};

type RenewalRow = ActivationRow & {
  subscription_status: string;
  expires_at: Date | string | null;
  grace_until: Date | string | null;
  plan_code: string;
  plan_enabled: boolean;
  features: Record<string, boolean>;
  numeric_limits: Record<string, number>;
  organization_name: string;
  key_prefix: string;
  edge_status: string | null;
};

const TOKEN_SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_FAILURES = 10;
const ONLINE_LEASE_MS = 24 * 60 * 60 * 1000;

function asDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function asNow(context?: ActivationContext) {
  return context?.now ? new Date(context.now) : new Date();
}

function sourceIp(context?: ActivationContext) {
  return context?.sourceIp?.trim() || null;
}

function productKeyPrefix(input: string) {
  try {
    return normalizeProductKey(input).slice(0, 12);
  } catch {
    return null;
  }
}

function subscriptionUsable(row: Pick<LicenseRow | RenewalRow, "subscription_status" | "expires_at" | "grace_until" | "plan_enabled">, now: Date) {
  if (!row.plan_enabled) return false;
  const expiresAt = asDate(row.expires_at);
  const graceUntil = asDate(row.grace_until);
  if (["suspended", "expired", "cancelled"].includes(row.subscription_status)) return false;
  if (row.subscription_status === "past_due") return Boolean(graceUntil && graceUntil > now);
  if (!["trial", "active"].includes(row.subscription_status)) return false;
  if (!expiresAt || expiresAt > now) return true;
  return Boolean(graceUntil && graceUntil > now);
}

function commercialLeaseCap(row: Pick<LicenseRow | RenewalRow, "expires_at" | "grace_until">) {
  return asDate(row.grace_until) ?? asDate(row.expires_at);
}

function deriveActivationTokenHash(token: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(token, salt, 32, TOKEN_SCRYPT_OPTIONS, (error, derived) => {
      if (error) return reject(error);
      resolve(Buffer.from(derived));
    });
  });
}

async function issueActivationToken() {
  const token = randomBytes(32).toString("base64url");
  const salt = randomBytes(16);
  return { token, salt, hash: await deriveActivationTokenHash(token, salt) };
}

async function verifyActivationToken(token: string, salt: Buffer, expectedHash: Buffer) {
  if (salt.length !== 16 || expectedHash.length !== 32 || token.length < 32 || token.length > 256) return false;
  const actual = await deriveActivationTokenHash(token, salt);
  return timingSafeEqual(actual, expectedHash);
}

async function recordAttempt(
  client: QueryClient,
  input: {
    organizationId?: string | null;
    productKeyId?: string | null;
    activationId?: string | null;
    keyPrefix?: string | null;
    installationId: string;
    sourceIp?: string | null;
    outcome: "success" | "invalid_key" | "rate_limited" | "seat_limit" | "subscription_inactive" | "key_inactive" | "activation_inactive" | "error";
    occurredAt: Date;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `insert into product_activation_attempts
      (organization_id,product_key_id,activation_id,key_prefix,installation_id,source_ip,outcome,metadata,occurred_at)
     values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::inet,$7,$8::jsonb,$9)`,
    [
      input.organizationId ?? null,
      input.productKeyId ?? null,
      input.activationId ?? null,
      input.keyPrefix ?? null,
      input.installationId,
      input.sourceIp ?? null,
      input.outcome,
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt
    ]
  );
}

async function rateLimited(client: QueryClient, keyPrefix: string | null, installationId: string, ip: string | null, now: Date) {
  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
  const found = await client.query<{ count: number }>(
    `select count(*)::int as count
     from product_activation_attempts
     where occurred_at >= $4
       and outcome <> 'success'
       and (
         ($1::text is not null and $3::inet is not null and key_prefix=$1 and source_ip=$3::inet)
         or installation_id=$2
       )`,
    [keyPrefix, installationId, ip, since]
  );
  return (found.rows[0]?.count ?? 0) >= RATE_LIMIT_FAILURES;
}

async function issueEntitlement(
  client: QueryClient,
  row: Pick<LicenseRow | RenewalRow, "organization_id" | "subscription_id" | "plan_code" | "features" | "numeric_limits" | "expires_at" | "grace_until">,
  activationId: string,
  installationId: string,
  now: Date
) {
  const signingKeyId = process.env.IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID?.trim();
  if (!signingKeyId) throw new Error("Entitlement signing key is not configured");

  const cap = commercialLeaseCap(row);
  let onlineValidUntil = new Date(now.getTime() + ONLINE_LEASE_MS);
  if (cap && cap < onlineValidUntil) onlineValidUntil = cap;
  let offlineGraceUntil = new Date(offlineGraceUntilFor(onlineValidUntil));
  if (cap && cap < offlineGraceUntil) offlineGraceUntil = cap;
  if (onlineValidUntil < now || offlineGraceUntil < onlineValidUntil) throw new ActivationServiceError("subscription_inactive");

  const entitlementId = randomUUID();
  const payload: EntitlementPayload = {
    schemaVersion: 1,
    product: "ipresenterplux",
    audience: "edge-desktop",
    entitlementId,
    organizationId: row.organization_id,
    subscriptionId: row.subscription_id,
    planCode: row.plan_code,
    activationId,
    installationId,
    issuedAt: now.toISOString(),
    onlineValidUntil: onlineValidUntil.toISOString(),
    offlineGraceUntil: offlineGraceUntil.toISOString(),
    features: row.features ?? {},
    limits: row.numeric_limits ?? {},
    signingKeyId
  };
  const envelope = signEntitlement(payload);

  await client.query(
    `insert into entitlement_leases
      (entitlement_id,organization_id,subscription_id,activation_id,signing_key_id,issued_at,online_valid_until,offline_grace_until,features,limits)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
    [
      entitlementId,
      row.organization_id,
      row.subscription_id,
      activationId,
      signingKeyId,
      now,
      onlineValidUntil,
      offlineGraceUntil,
      JSON.stringify(row.features ?? {}),
      JSON.stringify(row.numeric_limits ?? {})
    ]
  );
  await client.query(
    `update product_activations set last_entitlement_id=$2,last_validated_at=$3,updated_at=$3 where id=$1`,
    [activationId, entitlementId, now]
  );
  return { envelope, entitlementId };
}

async function loadLicenseForUpdate(client: QueryClient, prefix: string) {
  const result = await client.query<LicenseRow>(
    `select pk.id::text as product_key_id,pk.organization_id::text,pk.subscription_id::text,
            pk.key_salt,pk.key_hash,pk.status as key_status,pk.activation_limit,pk.valid_until,
            os.status as subscription_status,os.expires_at,os.grace_until,os.device_seat_limit,
            sp.code as plan_code,sp.enabled as plan_enabled,sp.default_device_seat_limit,
            sp.features,sp.numeric_limits,o.name as organization_name
     from product_keys pk
     join organization_subscriptions os on os.id=pk.subscription_id and os.organization_id=pk.organization_id
     join subscription_plans sp on sp.id=os.plan_id
     join organizations o on o.id=pk.organization_id
     where pk.key_prefix=$1
     limit 1
     for update of pk,os`,
    [prefix]
  );
  return result.rows[0] ?? null;
}

export async function activateProduct(client: QueryClient, request: ActivationRequest, context: ActivationContext = {}) {
  const now = asNow(context);
  const ip = sourceIp(context);
  const prefix = productKeyPrefix(request.productKey);
  if (await rateLimited(client, prefix, request.installationId, ip, now)) {
    await recordAttempt(client, { keyPrefix: prefix, installationId: request.installationId, sourceIp: ip, outcome: "rate_limited", occurredAt: now });
    throw new ActivationServiceError("rate_limited");
  }
  if (!prefix) {
    await recordAttempt(client, { installationId: request.installationId, sourceIp: ip, outcome: "invalid_key", occurredAt: now });
    throw new ActivationServiceError("invalid_key");
  }

  const license = await loadLicenseForUpdate(client, prefix);
  if (!license || !(await verifyProductKey(request.productKey, license.key_salt, license.key_hash))) {
    await recordAttempt(client, {
      organizationId: license?.organization_id,
      productKeyId: license?.product_key_id,
      keyPrefix: prefix,
      installationId: request.installationId,
      sourceIp: ip,
      outcome: "invalid_key",
      occurredAt: now
    });
    throw new ActivationServiceError("invalid_key");
  }

  if (license.key_status !== "active" || (asDate(license.valid_until)?.getTime() ?? Number.POSITIVE_INFINITY) <= now.getTime()) {
    await recordAttempt(client, { organizationId: license.organization_id, productKeyId: license.product_key_id, keyPrefix: prefix, installationId: request.installationId, sourceIp: ip, outcome: "key_inactive", occurredAt: now });
    throw new ActivationServiceError("key_inactive");
  }
  if (!subscriptionUsable(license, now)) {
    await recordAttempt(client, { organizationId: license.organization_id, productKeyId: license.product_key_id, keyPrefix: prefix, installationId: request.installationId, sourceIp: ip, outcome: "subscription_inactive", occurredAt: now });
    throw new ActivationServiceError("subscription_inactive");
  }

  const existingResult = await client.query<ActivationRow>(
    `select id::text,organization_id::text,subscription_id::text,product_key_id::text,installation_id,state,
            activation_token_salt,activation_token_hash,edge_device_id::text
     from product_activations
     where organization_id=$1 and installation_id=$2
     limit 1
     for update`,
    [license.organization_id, request.installationId]
  );
  const existing = existingResult.rows[0] ?? null;
  if (existing && existing.state !== "active") {
    await recordAttempt(client, { organizationId: license.organization_id, productKeyId: license.product_key_id, activationId: existing.id, keyPrefix: prefix, installationId: request.installationId, sourceIp: ip, outcome: "activation_inactive", occurredAt: now });
    throw new ActivationServiceError("activation_inactive");
  }

  if (!existing) {
    const seatLimit = license.device_seat_limit ?? license.default_device_seat_limit;
    const [subscriptionSeats, keySeats] = await Promise.all([
      client.query<{ count: number }>("select count(*)::int as count from product_activations where subscription_id=$1 and state='active'", [license.subscription_id]),
      client.query<{ count: number }>("select count(*)::int as count from product_activations where product_key_id=$1 and state='active'", [license.product_key_id])
    ]);
    if ((subscriptionSeats.rows[0]?.count ?? 0) >= seatLimit || (keySeats.rows[0]?.count ?? 0) >= license.activation_limit) {
      await recordAttempt(client, { organizationId: license.organization_id, productKeyId: license.product_key_id, keyPrefix: prefix, installationId: request.installationId, sourceIp: ip, outcome: "seat_limit", occurredAt: now });
      throw new ActivationServiceError("seat_limit");
    }
  }

  const activationId = existing?.id ?? randomUUID();
  const token = await issueActivationToken();
  if (existing) {
    await client.query(
      `update product_activations
       set product_key_id=$2,subscription_id=$3,platform=$4,app_version=$5,device_name=$6,
           activation_token_salt=$7,activation_token_hash=$8,last_validated_at=$9,updated_at=$9
       where id=$1`,
      [activationId, license.product_key_id, license.subscription_id, request.platform, request.appVersion, request.deviceName, token.salt, token.hash, now]
    );
  } else {
    await client.query(
      `insert into product_activations
        (id,organization_id,subscription_id,product_key_id,installation_id,platform,app_version,device_name,activation_token_salt,activation_token_hash,state,activated_at,last_validated_at,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11,$11,$11)`,
      [activationId, license.organization_id, license.subscription_id, license.product_key_id, request.installationId, request.platform, request.appVersion, request.deviceName, token.salt, token.hash, now]
    );
  }
  await client.query(
    `update product_keys
     set first_activated_at=coalesce(first_activated_at,$2),last_activated_at=$2,updated_at=$2
     where id=$1`,
    [license.product_key_id, now]
  );
  const entitlement = await issueEntitlement(client, license, activationId, request.installationId, now);
  await recordAttempt(client, {
    organizationId: license.organization_id,
    productKeyId: license.product_key_id,
    activationId,
    keyPrefix: prefix,
    installationId: request.installationId,
    sourceIp: ip,
    outcome: "success",
    occurredAt: now,
    metadata: { action: existing ? "reactivate" : "activate" }
  });

  return {
    activationId,
    activationToken: token.token,
    entitlement: entitlement.envelope,
    organization: { id: license.organization_id, name: license.organization_name },
    pairingRequired: true as const
  };
}

async function loadRenewalForUpdate(client: QueryClient, activationId: string) {
  const result = await client.query<RenewalRow>(
    `select pa.id::text,pa.organization_id::text,pa.subscription_id::text,pa.product_key_id::text,
            pa.installation_id,pa.state,pa.activation_token_salt,pa.activation_token_hash,pa.edge_device_id::text,
            os.status as subscription_status,os.expires_at,os.grace_until,
            sp.code as plan_code,sp.enabled as plan_enabled,sp.features,sp.numeric_limits,
            o.name as organization_name,pk.key_prefix,ed.status as edge_status
     from product_activations pa
     join organization_subscriptions os on os.id=pa.subscription_id and os.organization_id=pa.organization_id
     join subscription_plans sp on sp.id=os.plan_id
     join organizations o on o.id=pa.organization_id
     join product_keys pk on pk.id=pa.product_key_id
     left join edge_devices ed on ed.id=pa.edge_device_id
     where pa.id=$1::uuid
     limit 1
     for update of pa,os`,
    [activationId]
  );
  return result.rows[0] ?? null;
}

export async function renewProductActivation(client: QueryClient, request: RenewalRequest, context: ActivationContext = {}) {
  const now = asNow(context);
  const row = await loadRenewalForUpdate(client, request.activationId);
  if (!row || row.installation_id !== request.installationId) throw new ActivationServiceError("not_found");
  if (row.state !== "active" || (row.edge_device_id && row.edge_status !== "active")) {
    await recordAttempt(client, { organizationId: row.organization_id, productKeyId: row.product_key_id, activationId: row.id, keyPrefix: row.key_prefix, installationId: request.installationId, sourceIp: sourceIp(context), outcome: "activation_inactive", occurredAt: now, metadata: { action: "renew" } });
    throw new ActivationServiceError("activation_inactive");
  }
  if (!(await verifyActivationToken(request.activationToken, row.activation_token_salt, row.activation_token_hash))) {
    await recordAttempt(client, { organizationId: row.organization_id, productKeyId: row.product_key_id, activationId: row.id, keyPrefix: row.key_prefix, installationId: request.installationId, sourceIp: sourceIp(context), outcome: "error", occurredAt: now, metadata: { action: "renew", reason: "invalid_token" } });
    throw new ActivationServiceError("invalid_token");
  }
  if (!subscriptionUsable(row, now)) {
    await recordAttempt(client, { organizationId: row.organization_id, productKeyId: row.product_key_id, activationId: row.id, keyPrefix: row.key_prefix, installationId: request.installationId, sourceIp: sourceIp(context), outcome: "subscription_inactive", occurredAt: now, metadata: { action: "renew" } });
    throw new ActivationServiceError("subscription_inactive");
  }

  const entitlement = await issueEntitlement(client, row, row.id, row.installation_id, now);
  await recordAttempt(client, { organizationId: row.organization_id, productKeyId: row.product_key_id, activationId: row.id, keyPrefix: row.key_prefix, installationId: request.installationId, sourceIp: sourceIp(context), outcome: "success", occurredAt: now, metadata: { action: "renew", previousEntitlementId: request.currentEntitlementId } });
  return { activationId: row.id, entitlement: entitlement.envelope };
}

export async function linkActivationToEdge(
  client: QueryClient,
  request: { activationId: string; installationId: string; organizationId: string; edgeDeviceId: string }
) {
  const activation = await client.query<{ id: string; organization_id: string; installation_id: string; state: string }>(
    `select id::text,organization_id::text,installation_id,state
     from product_activations where id=$1::uuid limit 1 for update`,
    [request.activationId]
  );
  const row = activation.rows[0];
  if (!row || row.installation_id !== request.installationId) throw new ActivationServiceError("not_found");
  if (row.organization_id !== request.organizationId) throw new ActivationServiceError("organization_mismatch");
  if (row.state !== "active") throw new ActivationServiceError("activation_inactive");

  const edge = await client.query<{ organization_id: string; status: string }>(
    "select organization_id::text,status from edge_devices where id=$1::uuid limit 1 for update",
    [request.edgeDeviceId]
  );
  if (!edge.rows[0]) throw new ActivationServiceError("not_found");
  if (edge.rows[0].organization_id !== request.organizationId) throw new ActivationServiceError("organization_mismatch");
  if (edge.rows[0].status !== "active") throw new ActivationServiceError("activation_inactive");

  await client.query(
    "update product_activations set edge_device_id=$2,updated_at=now() where id=$1",
    [request.activationId, request.edgeDeviceId]
  );
  return { activationId: request.activationId, edgeDeviceId: request.edgeDeviceId };
}
