import type { PoolClient } from "pg";
import { db } from "./db.ts";
import { roleCapabilities } from "./role-capabilities.ts";
import type { StudioNavigationCapabilities } from "../components/navigation/studio-routes.ts";

type QueryClient = Pick<PoolClient, "query">;

type Options = {
  client?: QueryClient;
  organizationId?: string | null;
  now?: Date;
};

type MembershipRow = {
  organization_id: string;
  organization_name: string;
  roles: string[];
};

type ServiceRow = {
  id: string;
  organization_id: string;
  campus_id: string | null;
  campus_name: string | null;
  title: string;
  status: string;
  active_bible_version: string;
  auto_preview_threshold: string | number;
  ai_enabled: boolean;
  updated_at: string;
};

type SubscriptionRow = {
  status: string;
  starts_at: Date | string;
  expires_at: Date | string | null;
  grace_until: Date | string | null;
  plan_enabled: boolean;
  features: Record<string, unknown>;
};

export type CurrentServiceCapabilities = ReturnType<typeof roleCapabilities> & StudioNavigationCapabilities;

function asDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function activeFeatures(row: SubscriptionRow | undefined, now: Date) {
  if (!row || !row.plan_enabled) return {} as Record<string, boolean>;
  const startsAt = asDate(row.starts_at);
  const expiresAt = asDate(row.expires_at);
  const graceUntil = asDate(row.grace_until);
  if (!startsAt || startsAt > now || ["suspended", "expired", "cancelled"].includes(row.status)) return {};

  const active = row.status === "past_due"
    ? Boolean(graceUntil && graceUntil >= now)
    : ["trial", "active"].includes(row.status)
      ? Boolean(!expiresAt || expiresAt >= now || (graceUntil && graceUntil >= now))
      : false;
  if (!active) return {};

  return Object.fromEntries(
    Object.entries(row.features ?? {}).map(([feature, enabled]) => [feature, enabled === true])
  );
}

export function resolveStudioNavigationCapabilities(
  roles: readonly string[],
  features: Record<string, boolean>
): CurrentServiceCapabilities {
  const role = roleCapabilities(roles);
  const corePresentation = features["core.presentation"] === true;
  return {
    ...role,
    canMedia: role.canViewPlanner && corePresentation,
    canCameras: role.canViewPlanner && corePresentation,
    canAIDirector: role.canLiveControl && features["ai.director"] === true,
    canTranslations: role.canTranslations && (
      features["translations.text"] === true || features["translations.audio"] === true
    ),
    canStreaming: role.canStreaming && (
      features["streaming.web"] === true || features["streaming.social"] === true
    ),
    canArchive: roles.length > 0,
    canSettings: role.canSettings
  };
}

// Backward-compatible alias for any in-flight callers created while this workstream was being implemented.
export const navigationCapabilitiesFor = resolveStudioNavigationCapabilities;

export async function getCurrentServiceForUser(userId: string, options: Options = {}) {
  const client = options.client ?? db;
  const values: unknown[] = [userId];
  let organizationFilter = "";
  if (options.organizationId) {
    values.push(options.organizationId);
    organizationFilter = `and o.id=$${values.length}::uuid`;
  }

  const membership = await client.query<MembershipRow>(
    `select o.id::text as organization_id,o.name as organization_name,
            array_agg(uor.role_id order by uor.role_id) as roles
       from user_organization_roles uor
       join organizations o on o.id=uor.organization_id
      where uor.user_id=$1 ${organizationFilter}
      group by o.id,o.name
      order by min(uor.granted_at),o.id
      limit 1`,
    values
  );
  const member = membership.rows[0];
  if (!member) return null;

  const roles = member.roles ?? [];
  const serviceResult = await client.query<ServiceRow>(
    `select s.id::text,s.organization_id::text,s.campus_id::text,c.name as campus_name,
            s.title,s.status,s.active_bible_version,s.auto_preview_threshold,s.ai_enabled,s.updated_at::text
       from services s
       left join campuses c on c.id=s.campus_id
      where s.organization_id=$1::uuid and s.status in ('live','ready')
      order by case s.status when 'live' then 0 else 1 end,s.updated_at desc,s.id desc
      limit 1`,
    [member.organization_id]
  );
  const subscriptionResult = await client.query<SubscriptionRow>(
    `select os.status,os.starts_at,os.expires_at,os.grace_until,
            sp.enabled as plan_enabled,sp.features
       from organization_subscriptions os
       join subscription_plans sp on sp.id=os.plan_id
      where os.organization_id=$1::uuid
      order by case when os.status in ('trial','active','past_due','suspended') then 0 else 1 end,
               os.created_at desc,os.id desc
      limit 1`,
    [member.organization_id]
  );

  const now = options.now ? new Date(options.now) : new Date();
  const entitlementFeatures = activeFeatures(subscriptionResult.rows[0], now);
  const capabilities = resolveStudioNavigationCapabilities(roles, entitlementFeatures);
  const row = serviceResult.rows[0];

  return {
    organizationId: member.organization_id,
    organizationName: member.organization_name,
    roles,
    entitlementFeatures,
    capabilities,
    // Keep explicit aliases while callers migrate to the combined capability object.
    roleCapabilities: roleCapabilities(roles),
    navigationCapabilities: capabilities,
    service: row ? {
      id: row.id,
      organizationId: row.organization_id,
      campusId: row.campus_id,
      campusName: row.campus_name,
      title: row.title,
      status: row.status,
      activeBibleVersion: row.active_bible_version,
      autoPreviewThreshold: Number(row.auto_preview_threshold),
      aiEnabled: row.ai_enabled,
      updatedAt: row.updated_at
    } : null
  };
}
