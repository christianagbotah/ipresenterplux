import type { PoolClient } from "pg";
import { db } from "../db.ts";

type QueryClient = Pick<PoolClient, "query">;

export type EntitlementAccessErrorCode =
  | "subscription_missing"
  | "subscription_inactive"
  | "subscription_expired"
  | "feature_unavailable";

export class EntitlementAccessError extends Error {
  readonly code: EntitlementAccessErrorCode;
  readonly httpStatus = 403;
  readonly featureId: string;

  constructor(code: EntitlementAccessErrorCode, featureId: string, message = "Subscription entitlement does not allow this operation") {
    super(message);
    this.name = "EntitlementAccessError";
    this.code = code;
    this.featureId = featureId;
  }
}

export type EffectiveEntitlement = {
  organizationId: string;
  subscriptionId: string;
  planCode: string;
  featureId: string;
  state: "online" | "grace";
  expiresAt: string | null;
  graceUntil: string | null;
  limits: Record<string, number>;
};

type SubscriptionRow = {
  id: string;
  status: string;
  starts_at: Date | string;
  expires_at: Date | string | null;
  grace_until: Date | string | null;
  plan_code: string;
  plan_enabled: boolean;
  features: Record<string, unknown>;
  numeric_limits: Record<string, unknown>;
};

function asDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function numericLimits(value: Record<string, unknown> | null | undefined) {
  const result: Record<string, number> = {};
  for (const [key, current] of Object.entries(value ?? {})) {
    if (typeof current === "number" && Number.isFinite(current)) result[key] = current;
  }
  return result;
}

export async function requireEntitlementFeature(
  organizationId: string,
  featureId: string,
  options: { client?: QueryClient; now?: Date } = {}
): Promise<EffectiveEntitlement> {
  if (!organizationId || !featureId) throw new EntitlementAccessError("subscription_missing", featureId || "unknown");
  const client = options.client ?? db;
  const now = options.now ? new Date(options.now) : new Date();

  const result = await client.query<SubscriptionRow>(
    `select os.id::text,os.status,os.starts_at,os.expires_at,os.grace_until,
            sp.code as plan_code,sp.enabled as plan_enabled,sp.features,sp.numeric_limits
     from organization_subscriptions os
     join subscription_plans sp on sp.id=os.plan_id
     where os.organization_id=$1::uuid
     order by case when os.status in ('trial','active','past_due','suspended') then 0 else 1 end,
              os.created_at desc,os.id desc
     limit 1`,
    [organizationId]
  );
  const row = result.rows[0];
  if (!row) throw new EntitlementAccessError("subscription_missing", featureId, "No subscription is configured for this organization");

  const startsAt = asDate(row.starts_at);
  const expiresAt = asDate(row.expires_at);
  const graceUntil = asDate(row.grace_until);
  if (!row.plan_enabled || !startsAt || startsAt > now || ["suspended", "expired", "cancelled"].includes(row.status)) {
    throw new EntitlementAccessError("subscription_inactive", featureId, "The subscription is not active");
  }

  let state: "online" | "grace";
  if (row.status === "past_due") {
    if (!graceUntil || graceUntil < now) throw new EntitlementAccessError("subscription_expired", featureId, "The subscription grace period has expired");
    state = "grace";
  } else if (["trial", "active"].includes(row.status)) {
    if (!expiresAt || expiresAt >= now) state = "online";
    else if (graceUntil && graceUntil >= now) state = "grace";
    else throw new EntitlementAccessError("subscription_expired", featureId, "The subscription has expired");
  } else {
    throw new EntitlementAccessError("subscription_inactive", featureId, "The subscription is not active");
  }

  if (row.features?.[featureId] !== true) {
    throw new EntitlementAccessError("feature_unavailable", featureId, "This feature is not included in the current plan");
  }

  return {
    organizationId,
    subscriptionId: row.id,
    planCode: row.plan_code,
    featureId,
    state,
    expiresAt: expiresAt?.toISOString() ?? null,
    graceUntil: graceUntil?.toISOString() ?? null,
    limits: numericLimits(row.numeric_limits)
  };
}
