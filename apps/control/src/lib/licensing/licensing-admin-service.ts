import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { generateProductKey } from "./product-keys.ts";

type QueryClient = Pick<PoolClient, "query">;

type AdminContext = { now?: Date };

export type LicensingAdminErrorCode =
  | "not_found"
  | "tenant_mismatch"
  | "invalid_status"
  | "current_subscription_exists";

export class LicensingAdminError extends Error {
  readonly code: LicensingAdminErrorCode;

  constructor(code: LicensingAdminErrorCode, message = "Licensing administration request could not be completed") {
    super(message);
    this.name = "LicensingAdminError";
    this.code = code;
  }
}

function nowFrom(context?: AdminContext) {
  return context?.now ? new Date(context.now) : new Date();
}

async function recordAudit(
  client: QueryClient,
  input: {
    organizationId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    now: Date;
  }
) {
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details,created_at)
     values ($1,'user',$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      input.organizationId,
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.details ?? {}),
      input.now
    ]
  );
}

async function loadSubscriptionForUpdate(client: QueryClient, subscriptionId: string) {
  const result = await client.query<{
    id: string;
    organization_id: string;
    plan_id: string;
    status: string;
    expires_at: Date | string | null;
    grace_until: Date | string | null;
  }>(
    `select id::text,organization_id::text,plan_id::text,status,expires_at,grace_until
     from organization_subscriptions
     where id=$1::uuid
     limit 1
     for update`,
    [subscriptionId]
  );
  return result.rows[0] ?? null;
}

async function loadProductKeyForUpdate(client: QueryClient, productKeyId: string) {
  const result = await client.query<{
    id: string;
    organization_id: string;
    subscription_id: string;
    status: string;
    activation_limit: number;
    valid_until: Date | string | null;
    note: string | null;
    batch_reference: string | null;
  }>(
    `select id::text,organization_id::text,subscription_id::text,status,activation_limit,valid_until,note,batch_reference
     from product_keys
     where id=$1::uuid
     limit 1
     for update`,
    [productKeyId]
  );
  return result.rows[0] ?? null;
}

export async function issueProductKeyForSubscription(
  client: QueryClient,
  input: {
    subscriptionId: string;
    actorUserId: string;
    activationLimit?: number;
    validUntil?: Date | string | null;
    note?: string | null;
    batchReference?: string | null;
  },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const subscription = await loadSubscriptionForUpdate(client, input.subscriptionId);
  if (!subscription) throw new LicensingAdminError("not_found", "Subscription was not found");

  const material = await generateProductKey();
  const id = randomUUID();
  const activationLimit = Math.max(1, Math.trunc(input.activationLimit ?? 1));
  await client.query(
    `insert into product_keys
      (id,organization_id,subscription_id,key_prefix,key_salt,key_hash,status,activation_limit,valid_until,issued_by,note,batch_reference,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$12)`,
    [
      id,
      subscription.organization_id,
      subscription.id,
      material.prefix,
      material.salt,
      material.hash,
      activationLimit,
      input.validUntil ?? null,
      input.actorUserId,
      input.note?.trim() || null,
      input.batchReference?.trim() || null,
      now
    ]
  );
  await recordAudit(client, {
    organizationId: subscription.organization_id,
    actorUserId: input.actorUserId,
    action: "licensing.product_key.issued",
    entityType: "product_key",
    entityId: id,
    details: { prefix: material.prefix, activationLimit, subscriptionId: subscription.id },
    now
  });

  return { id, prefix: material.prefix, status: "active" as const, displayKey: material.displayKey };
}

export async function listProductKeysForOrganization(client: QueryClient, organizationId: string) {
  const result = await client.query<{
    id: string;
    prefix: string;
    status: string;
    subscription_id: string;
    activation_limit: number;
    valid_until: string | null;
    first_activated_at: string | null;
    last_activated_at: string | null;
    note: string | null;
    batch_reference: string | null;
    created_at: string;
  }>(
    `select id::text,key_prefix as prefix,status,subscription_id::text,activation_limit,
            valid_until::text,first_activated_at::text,last_activated_at::text,note,batch_reference,created_at::text
     from product_keys
     where organization_id=$1
     order by created_at desc,id desc`,
    [organizationId]
  );
  return result.rows;
}

export async function resetProductKey(
  client: QueryClient,
  input: { productKeyId: string; actorUserId: string; reason?: string | null },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const previous = await loadProductKeyForUpdate(client, input.productKeyId);
  if (!previous) throw new LicensingAdminError("not_found", "Product key was not found");

  if (previous.status !== "revoked") {
    await client.query(
      `update product_keys
       set status='revoked',revoked_at=$2,revoked_by=$3,revocation_reason=$4,updated_at=$2
       where id=$1`,
      [previous.id, now, input.actorUserId, input.reason?.trim() || "Reset and replaced"]
    );
  }

  const material = await generateProductKey();
  const replacementId = randomUUID();
  await client.query(
    `insert into product_keys
      (id,organization_id,subscription_id,key_prefix,key_salt,key_hash,status,activation_limit,valid_until,issued_by,note,batch_reference,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$12)`,
    [
      replacementId,
      previous.organization_id,
      previous.subscription_id,
      material.prefix,
      material.salt,
      material.hash,
      previous.activation_limit,
      previous.valid_until,
      input.actorUserId,
      previous.note,
      previous.batch_reference,
      now
    ]
  );
  await recordAudit(client, {
    organizationId: previous.organization_id,
    actorUserId: input.actorUserId,
    action: "licensing.product_key.reset",
    entityType: "product_key",
    entityId: previous.id,
    details: { replacementProductKeyId: replacementId, replacementPrefix: material.prefix },
    now
  });

  return { id: replacementId, prefix: material.prefix, status: "active" as const, displayKey: material.displayKey };
}

export async function revokeProductKey(
  client: QueryClient,
  input: { productKeyId: string; actorUserId: string; reason?: string | null },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const key = await loadProductKeyForUpdate(client, input.productKeyId);
  if (!key) throw new LicensingAdminError("not_found", "Product key was not found");

  if (key.status !== "revoked") {
    await client.query(
      `update product_keys
       set status='revoked',revoked_at=$2,revoked_by=$3,revocation_reason=$4,updated_at=$2
       where id=$1`,
      [key.id, now, input.actorUserId, input.reason?.trim() || "Revoked by product administrator"]
    );
  }
  await recordAudit(client, {
    organizationId: key.organization_id,
    actorUserId: input.actorUserId,
    action: "licensing.product_key.revoked",
    entityType: "product_key",
    entityId: key.id,
    details: { reason: input.reason?.trim() || null },
    now
  });
  return { id: key.id, status: "revoked" as const };
}

const SUBSCRIPTION_STATUSES = new Set(["trial", "active", "past_due", "suspended", "expired", "cancelled"]);

export async function setSubscriptionStatus(
  client: QueryClient,
  input: { subscriptionId: string; status: string; actorUserId: string; reason?: string | null },
  context: AdminContext = {}
) {
  if (!SUBSCRIPTION_STATUSES.has(input.status)) throw new LicensingAdminError("invalid_status", "Invalid subscription status");
  const now = nowFrom(context);
  const subscription = await loadSubscriptionForUpdate(client, input.subscriptionId);
  if (!subscription) throw new LicensingAdminError("not_found", "Subscription was not found");

  await client.query("update organization_subscriptions set status=$2,updated_at=$3 where id=$1", [subscription.id, input.status, now]);
  await recordAudit(client, {
    organizationId: subscription.organization_id,
    actorUserId: input.actorUserId,
    action: "licensing.subscription.status_changed",
    entityType: "organization_subscription",
    entityId: subscription.id,
    details: { previousStatus: subscription.status, status: input.status, reason: input.reason?.trim() || null },
    now
  });
  return { id: subscription.id, status: input.status };
}

export async function extendSubscription(
  client: QueryClient,
  input: { subscriptionId: string; days: number; actorUserId: string; reason?: string | null },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const subscription = await loadSubscriptionForUpdate(client, input.subscriptionId);
  if (!subscription) throw new LicensingAdminError("not_found", "Subscription was not found");
  const days = Math.max(1, Math.min(3650, Math.trunc(input.days)));
  const currentExpiry = subscription.expires_at ? new Date(subscription.expires_at) : now;
  const base = currentExpiry > now ? currentExpiry : now;
  const expiresAt = new Date(base.getTime() + days * 86_400_000);
  const currentGrace = subscription.grace_until ? new Date(subscription.grace_until) : null;
  const graceUntil = currentGrace && currentGrace > expiresAt ? currentGrace : currentGrace ? expiresAt : null;

  await client.query(
    "update organization_subscriptions set expires_at=$2,grace_until=$3,updated_at=$4 where id=$1",
    [subscription.id, expiresAt, graceUntil, now]
  );
  await recordAudit(client, {
    organizationId: subscription.organization_id,
    actorUserId: input.actorUserId,
    action: "licensing.subscription.extended",
    entityType: "organization_subscription",
    entityId: subscription.id,
    details: { days, expiresAt: expiresAt.toISOString(), reason: input.reason?.trim() || null },
    now
  });
  return { id: subscription.id, expiresAt: expiresAt.toISOString(), graceUntil: graceUntil?.toISOString() ?? null };
}

export async function setSubscriptionSeatLimit(
  client: QueryClient,
  input: { subscriptionId: string; seatLimit: number | null; actorUserId: string },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const subscription = await loadSubscriptionForUpdate(client, input.subscriptionId);
  if (!subscription) throw new LicensingAdminError("not_found", "Subscription was not found");
  const seatLimit = input.seatLimit == null ? null : Math.max(1, Math.trunc(input.seatLimit));
  await client.query("update organization_subscriptions set device_seat_limit=$2,updated_at=$3 where id=$1", [subscription.id, seatLimit, now]);
  await recordAudit(client, {
    organizationId: subscription.organization_id,
    actorUserId: input.actorUserId,
    action: "licensing.subscription.seat_limit_changed",
    entityType: "organization_subscription",
    entityId: subscription.id,
    details: { seatLimit },
    now
  });
  return { id: subscription.id, seatLimit };
}

export async function createOrganizationSubscription(
  client: QueryClient,
  input: { organizationId: string; planId: string; actorUserId: string; status?: string; deviceSeatLimit?: number | null; expiresAt?: Date | string | null },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const status = input.status ?? "active";
  if (!SUBSCRIPTION_STATUSES.has(status)) throw new LicensingAdminError("invalid_status", "Invalid subscription status");
  const current = await client.query(
    `select id from organization_subscriptions
     where organization_id=$1 and status in ('trial','active','past_due','suspended')
     limit 1 for update`,
    [input.organizationId]
  );
  if (current.rowCount) throw new LicensingAdminError("current_subscription_exists", "Organization already has a current subscription");
  const id = randomUUID();
  const seatLimit = input.deviceSeatLimit == null ? null : Math.max(1, Math.trunc(input.deviceSeatLimit));
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,device_seat_limit,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$5,$5)`,
    [id, input.organizationId, input.planId, status, now, input.expiresAt ?? null, seatLimit]
  );
  await recordAudit(client, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "licensing.subscription.created",
    entityType: "organization_subscription",
    entityId: id,
    details: { planId: input.planId, status, seatLimit },
    now
  });
  return { id, status };
}

export async function configureSubscriptionPlan(
  client: QueryClient,
  input: {
    planId: string;
    actorUserId: string;
    name?: string;
    enabled?: boolean;
    defaultDeviceSeatLimit?: number;
    features?: Record<string, boolean>;
    numericLimits?: Record<string, number>;
  },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const found = await client.query<{ id: string }>("select id::text from subscription_plans where id=$1::uuid limit 1 for update", [input.planId]);
  if (!found.rows[0]) throw new LicensingAdminError("not_found", "Subscription plan was not found");
  const seatLimit = input.defaultDeviceSeatLimit == null ? null : Math.max(1, Math.trunc(input.defaultDeviceSeatLimit));
  await client.query(
    `update subscription_plans set
       name=coalesce($2,name),
       enabled=coalesce($3,enabled),
       default_device_seat_limit=coalesce($4,default_device_seat_limit),
       features=coalesce($5::jsonb,features),
       numeric_limits=coalesce($6::jsonb,numeric_limits),
       updated_at=$7
     where id=$1`,
    [
      input.planId,
      input.name?.trim() || null,
      input.enabled ?? null,
      seatLimit,
      input.features ? JSON.stringify(input.features) : null,
      input.numericLimits ? JSON.stringify(input.numericLimits) : null,
      now
    ]
  );
  return { id: input.planId };
}

export async function getOrganizationSubscriptionOverview(client: QueryClient, organizationId: string) {
  const organization = await client.query<{ id: string; name: string }>(
    "select id::text,name from organizations where id=$1::uuid limit 1",
    [organizationId]
  );
  if (!organization.rows[0]) throw new LicensingAdminError("not_found", "Organization was not found");

  const subscriptionResult = await client.query<{
    id: string;
    status: string;
    starts_at: string;
    renews_at: string | null;
    expires_at: string | null;
    grace_until: string | null;
    device_seat_limit: number | null;
    plan_id: string;
    plan_code: string;
    plan_name: string;
    default_device_seat_limit: number;
    features: Record<string, boolean>;
    numeric_limits: Record<string, number>;
  }>(
    `select os.id::text,os.status,os.starts_at::text,os.renews_at::text,os.expires_at::text,os.grace_until::text,
            os.device_seat_limit,sp.id::text as plan_id,sp.code as plan_code,sp.name as plan_name,
            sp.default_device_seat_limit,sp.features,sp.numeric_limits
     from organization_subscriptions os
     join subscription_plans sp on sp.id=os.plan_id
     where os.organization_id=$1
     order by case when os.status in ('trial','active','past_due','suspended') then 0 else 1 end,os.created_at desc
     limit 1`,
    [organizationId]
  );
  const subscription = subscriptionResult.rows[0] ?? null;
  if (!subscription) {
    return {
      organizationId,
      organizationName: organization.rows[0].name,
      subscription: null,
      seats: { limit: 0, used: 0 },
      activations: []
    };
  }

  const seatLimit = subscription.device_seat_limit ?? subscription.default_device_seat_limit;
  const used = await client.query<{ count: number }>(
    "select count(*)::int as count from product_activations where organization_id=$1 and subscription_id=$2 and state='active'",
    [organizationId, subscription.id]
  );
  const activations = await client.query<{
    id: string;
    installation_id: string;
    device_name: string;
    platform: string;
    app_version: string;
    state: string;
    edge_device_id: string | null;
    activated_at: string;
    last_validated_at: string;
    deactivated_at: string | null;
    state_reason: string | null;
  }>(
    `select id::text,installation_id,device_name,platform,app_version,state,edge_device_id::text,
            activated_at::text,last_validated_at::text,deactivated_at::text,state_reason
     from product_activations
     where organization_id=$1 and subscription_id=$2
     order by activated_at desc,id desc`,
    [organizationId, subscription.id]
  );

  return {
    organizationId,
    organizationName: organization.rows[0].name,
    subscription: {
      id: subscription.id,
      status: subscription.status,
      startsAt: subscription.starts_at,
      renewsAt: subscription.renews_at,
      expiresAt: subscription.expires_at,
      graceUntil: subscription.grace_until,
      plan: {
        id: subscription.plan_id,
        code: subscription.plan_code,
        name: subscription.plan_name,
        features: subscription.features ?? {},
        numericLimits: subscription.numeric_limits ?? {}
      }
    },
    seats: { limit: seatLimit, used: used.rows[0]?.count ?? 0 },
    activations: activations.rows.map((row) => ({
      id: row.id,
      installationId: row.installation_id,
      deviceName: row.device_name,
      platform: row.platform,
      appVersion: row.app_version,
      state: row.state,
      edgeDeviceId: row.edge_device_id,
      activatedAt: row.activated_at,
      lastValidatedAt: row.last_validated_at,
      deactivatedAt: row.deactivated_at,
      stateReason: row.state_reason
    }))
  };
}

export async function deactivateOrganizationActivation(
  client: QueryClient,
  input: { organizationId: string; activationId: string; actorUserId: string; reason?: string | null },
  context: AdminContext = {}
) {
  const now = nowFrom(context);
  const found = await client.query<{ id: string; organization_id: string; state: string }>(
    `select id::text,organization_id::text,state
     from product_activations
     where id=$1::uuid
     limit 1
     for update`,
    [input.activationId]
  );
  const activation = found.rows[0];
  if (!activation) throw new LicensingAdminError("not_found", "Activation was not found");
  if (activation.organization_id !== input.organizationId) throw new LicensingAdminError("tenant_mismatch", "Activation belongs to another organization");

  if (activation.state === "active") {
    await client.query(
      `update product_activations
       set state='deactivated',state_reason=$2,deactivated_at=$3,updated_at=$3
       where id=$1`,
      [activation.id, input.reason?.trim() || "Deactivated by administrator", now]
    );
    await client.query(
      `update entitlement_leases
       set revoked_at=coalesce(revoked_at,$2),revoked_by=coalesce(revoked_by,$3),revocation_reason=coalesce(revocation_reason,$4)
       where activation_id=$1 and revoked_at is null`,
      [activation.id, now, input.actorUserId, input.reason?.trim() || "Activation deactivated"]
    );
  }
  await recordAudit(client, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "licensing.activation.deactivated",
    entityType: "product_activation",
    entityId: activation.id,
    details: { reason: input.reason?.trim() || null },
    now
  });
  return { id: activation.id, state: "deactivated" as const };
}

export async function listLicensingAudit(client: QueryClient, organizationId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  const result = await client.query<{
    id: string;
    action: string;
    actor_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }>(
    `select id::text,action,actor_id,entity_type,entity_id,details,created_at::text
     from audit_events
     where organization_id=$1 and action like 'licensing.%'
     order by created_at desc,id desc
     limit $2`,
    [organizationId, safeLimit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details ?? {},
    createdAt: row.created_at
  }));
}
