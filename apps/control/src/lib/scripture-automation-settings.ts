import type { PoolClient } from "pg";
import { LIVE_OPERATOR_ROLES } from "./role-policy.js";
import type { ScriptureAutomationMode } from "./scripture-automation.ts";

const ADMIN_ROLES = ["owner", "admin"] as const;
const REFERENCE_FLOOR = 98;
const QUOTE_FLOOR = 96;

type ServicePolicyRow = {
  id: string;
  organization_id: string;
  status: string;
  scripture_automation_mode: ScriptureAutomationMode;
  auto_scripture_reference_threshold: string;
  auto_scripture_quote_threshold: string;
  scripture_automation_armed_at: string | null;
  scripture_automation_armed_by: string | null;
  scripture_automation_suspended_reason: string | null;
  auto_scripture_live_enabled: boolean;
};

export class ScriptureAutomationSettingsError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ScriptureAutomationSettingsError";
    this.status = status;
    this.code = code;
  }
}

async function requireAnyRole(
  client: PoolClient,
  userId: string,
  organizationId: string,
  roles: readonly string[],
  code: string,
  message: string
) {
  const allowed = await client.query<{ allowed: boolean }>(
    `select exists(
       select 1 from user_organization_roles
       where user_id=$1::uuid and organization_id=$2::uuid and role_id=any($3::text[])
     ) as allowed`,
    [userId, organizationId, [...roles]]
  );
  if (!allowed.rows[0]?.allowed) throw new ScriptureAutomationSettingsError(403, code, message);
}

function threshold(value: number | undefined, current: string, floor: number, code: string, label: string) {
  const next = value ?? Number(current);
  if (!Number.isFinite(next) || next > 100) {
    throw new ScriptureAutomationSettingsError(400, `${code}_invalid`, `${label} must be between ${floor} and 100`);
  }
  if (next < floor) {
    throw new ScriptureAutomationSettingsError(400, code, `${label} cannot be lower than the product safety floor of ${floor}`);
  }
  return next;
}

export async function setOrganizationScriptureAutomationPermission(
  client: PoolClient,
  actorUserId: string,
  organizationId: string,
  enabled: boolean
) {
  const organization = await client.query<{ id: string; auto_scripture_live_enabled: boolean }>(
    `select id::text,auto_scripture_live_enabled
       from organizations
      where id=$1::uuid
      for update`,
    [organizationId]
  );
  const current = organization.rows[0];
  if (!current) throw new ScriptureAutomationSettingsError(404, "organization_not_found", "Organization not found");
  await requireAnyRole(
    client,
    actorUserId,
    organizationId,
    ADMIN_ROLES,
    "scripture_automation_admin_forbidden",
    "Only owners and administrators can change Auto Scripture Live organization permission"
  );

  await client.query(
    `update organizations
        set auto_scripture_live_enabled=$2
      where id=$1::uuid`,
    [organizationId, enabled]
  );

  let disarmedServices = 0;
  if (!enabled) {
    const disarmed = await client.query(
      `update services
          set scripture_automation_armed_at=null,
              scripture_automation_armed_by=null,
              scripture_automation_suspended_reason=case
                when scripture_automation_armed_at is not null
                  or scripture_automation_armed_by is not null
                  or scripture_automation_mode='auto_live'
                then 'organization_disabled'
                else scripture_automation_suspended_reason
              end,
              updated_at=clock_timestamp()
        where organization_id=$1::uuid
          and status <> 'ended'`,
      [organizationId]
    );
    disarmedServices = disarmed.rowCount ?? 0;
  }

  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1::uuid,'operator',$2,'scripture.automation.organization.changed','organization',($1::uuid)::text,$3::jsonb)`,
    [organizationId, actorUserId, JSON.stringify({ from: current.auto_scripture_live_enabled, to: enabled, disarmedServices })]
  );

  return { organizationId, autoScriptureLiveEnabled: enabled, disarmedServices };
}

export async function setServiceScriptureAutomation(
  client: PoolClient,
  actorUserId: string,
  serviceId: string,
  input: {
    mode: ScriptureAutomationMode;
    armed: boolean;
    referenceThreshold?: number;
    quoteThreshold?: number;
  }
) {
  if (!["manual", "auto_preview", "auto_live"].includes(input.mode)) {
    throw new ScriptureAutomationSettingsError(400, "scripture_automation_mode_invalid", "Invalid Scripture automation mode");
  }

  const found = await client.query<ServicePolicyRow>(
    `select s.id::text,s.organization_id::text,s.status,s.scripture_automation_mode,
            s.auto_scripture_reference_threshold::text,s.auto_scripture_quote_threshold::text,
            s.scripture_automation_armed_at::text,s.scripture_automation_armed_by::text,
            s.scripture_automation_suspended_reason,o.auto_scripture_live_enabled
       from services s
       join organizations o on o.id=s.organization_id
      where s.id=$1::uuid
      for update of s,o`,
    [serviceId]
  );
  const current = found.rows[0];
  if (!current) throw new ScriptureAutomationSettingsError(404, "service_not_found", "Service not found");

  await requireAnyRole(
    client,
    actorUserId,
    current.organization_id,
    LIVE_OPERATOR_ROLES,
    "scripture_automation_operator_forbidden",
    "You are not allowed to control Scripture automation for this service"
  );

  const referenceThreshold = threshold(
    input.referenceThreshold,
    current.auto_scripture_reference_threshold,
    REFERENCE_FLOOR,
    "reference_threshold_below_floor",
    "Explicit-reference confidence threshold"
  );
  const quoteThreshold = threshold(
    input.quoteThreshold,
    current.auto_scripture_quote_threshold,
    QUOTE_FLOOR,
    "quote_threshold_below_floor",
    "Quote confidence threshold"
  );
  const wasArmed = Boolean(current.scripture_automation_armed_at && current.scripture_automation_armed_by);
  const policyChanged = input.mode !== current.scripture_automation_mode
    || referenceThreshold !== Number(current.auto_scripture_reference_threshold)
    || quoteThreshold !== Number(current.auto_scripture_quote_threshold);
  const effectiveArmed = input.armed && !(wasArmed && policyChanged);
  const suspensionReason = effectiveArmed
    ? null
    : wasArmed && policyChanged
      ? "policy_changed"
      : wasArmed && !input.armed
        ? "operator_disarmed"
        : null;

  if (input.armed && input.mode !== "auto_live") {
    throw new ScriptureAutomationSettingsError(409, "auto_live_required_to_arm", "Only Auto Scripture Live mode can be armed");
  }

  if (effectiveArmed) {
    if (!current.auto_scripture_live_enabled) {
      throw new ScriptureAutomationSettingsError(409, "organization_auto_live_disabled", "Auto Scripture Live is disabled for this organization");
    }
    if (current.status !== "live") {
      throw new ScriptureAutomationSettingsError(409, "service_not_live", "Auto Scripture Live can only be armed for a live service");
    }
    const edge = await client.query<{ count: number }>(
      `select count(*)::int as count
         from edge_devices
        where organization_id=$1::uuid and active_service_id=$2::uuid and status='active'`,
      [current.organization_id, serviceId]
    );
    if ((edge.rows[0]?.count ?? 0) < 1) {
      throw new ScriptureAutomationSettingsError(409, "no_active_edge", "Auto Scripture Live requires an active Edge assigned to this service");
    }
  }

  const updated = await client.query<{
    scripture_automation_mode: ScriptureAutomationMode;
    auto_scripture_reference_threshold: string;
    auto_scripture_quote_threshold: string;
    scripture_automation_armed_at: string | null;
    scripture_automation_armed_by: string | null;
    scripture_automation_suspended_reason: string | null;
  }>(
    `update services
        set scripture_automation_mode=$2,
            auto_scripture_reference_threshold=$3,
            auto_scripture_quote_threshold=$4,
            scripture_automation_armed_at=case when $5 then coalesce(scripture_automation_armed_at,clock_timestamp()) else null end,
            scripture_automation_armed_by=case when $5 then $6::uuid else null end,
            scripture_automation_suspended_reason=$7,
            updated_at=clock_timestamp()
      where id=$1::uuid
      returning scripture_automation_mode,auto_scripture_reference_threshold::text,
                auto_scripture_quote_threshold::text,scripture_automation_armed_at::text,
                scripture_automation_armed_by::text,scripture_automation_suspended_reason`,
    [serviceId, input.mode, referenceThreshold, quoteThreshold, effectiveArmed, actorUserId, suspensionReason]
  );
  const next = updated.rows[0];

  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'scripture.automation.service.changed','service',$3,$4::jsonb)`,
    [
      current.organization_id,
      actorUserId,
      serviceId,
      JSON.stringify({
        from: {
          mode: current.scripture_automation_mode,
          armed: Boolean(current.scripture_automation_armed_at && current.scripture_automation_armed_by),
          referenceThreshold: Number(current.auto_scripture_reference_threshold),
          quoteThreshold: Number(current.auto_scripture_quote_threshold)
        },
        to: { mode: next.scripture_automation_mode, armed: effectiveArmed, referenceThreshold, quoteThreshold, suspendedReason: suspensionReason }
      })
    ]
  );

  return {
    serviceId,
    organizationId: current.organization_id,
    mode: next.scripture_automation_mode,
    armed: Boolean(next.scripture_automation_armed_at && next.scripture_automation_armed_by),
    armedAt: next.scripture_automation_armed_at,
    armedBy: next.scripture_automation_armed_by,
    referenceThreshold: Number(next.auto_scripture_reference_threshold),
    quoteThreshold: Number(next.auto_scripture_quote_threshold),
    suspendedReason: next.scripture_automation_suspended_reason
  };
}

export async function suspendServiceScriptureAutomation(
  client: PoolClient,
  serviceId: string,
  reason: string
) {
  const normalizedReason = reason.trim().slice(0, 160);
  if (!normalizedReason) throw new ScriptureAutomationSettingsError(400, "suspension_reason_required", "Suspension reason is required");
  const updated = await client.query<{ id: string }>(
    `update services
        set scripture_automation_armed_at=null,
            scripture_automation_armed_by=null,
            scripture_automation_suspended_reason=$2,
            updated_at=clock_timestamp()
      where id=$1::uuid
      returning id::text`,
    [serviceId, normalizedReason]
  );
  if (!updated.rows[0]) throw new ScriptureAutomationSettingsError(404, "service_not_found", "Service not found");
  return { serviceId: updated.rows[0].id, reason: normalizedReason };
}
