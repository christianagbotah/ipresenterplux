import type { PoolClient } from "pg";
import { LIVE_OPERATOR_ROLES } from "./role-policy.js";
import { EntitlementAccessError, requireEntitlementFeature } from "./licensing/entitlement-access.ts";

const HEALTH_STALE_MS = 120_000;
const MIN_THRESHOLD = 50;
const MAX_THRESHOLD = 100;
const RECOMMENDATION_LIMIT = 12;

export class AIDirectorError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AIDirectorError";
    this.status = status;
    this.code = code;
  }
}

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  ai_enabled: boolean;
  auto_preview_threshold: string | number;
};

type MediaHealthRow = {
  name: string;
  status: string;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

type WorkerRow = {
  worker_id: string;
  provider: string;
  state: string;
  error_code: string | null;
  observed_at: string;
};

type DetectionRow = {
  id: string;
  scripture_reference: string;
  confidence: string | number;
  state: string;
  detection_method: string;
  source_text: string;
  source_observed_at: string;
};

export type AIDirectorHealth = {
  state: "healthy" | "degraded" | "offline";
  label: string;
  detail: string;
  observedAt: string | null;
};

export type AIDirectorState = {
  organizationId: string;
  service: null | {
    id: string;
    title: string;
    status: string;
    aiEnabled: boolean;
    autoPreviewThreshold: number;
  };
  health: {
    asr: AIDirectorHealth;
    translation: AIDirectorHealth;
    tts: AIDirectorHealth;
  };
  recommendations: Array<{
    id: string;
    reference: string;
    confidence: number;
    state: string;
    method: string;
    evidence: string;
    observedAt: string;
  }>;
  canManageSettings: boolean;
  entitled: boolean;
};

async function membershipRoles(client: PoolClient, userId: string, organizationId: string) {
  const result = await client.query<{ role_id: string }>(
    `select role_id
       from user_organization_roles
      where user_id=$1 and organization_id=$2
      order by role_id`,
    [userId, organizationId]
  );
  if (!result.rowCount) {
    throw new AIDirectorError(404, "ai_director_organization_not_found", "AI Director workspace was not found");
  }
  return result.rows.map((row) => row.role_id);
}

async function loadService(
  client: PoolClient,
  userId: string,
  organizationId: string,
  serviceId?: string | null,
  forUpdate = false
) {
  const values: unknown[] = [userId, organizationId];
  const serviceFilter = serviceId ? `and s.id=$3` : `and s.status in ('live','ready')`;
  if (serviceId) values.push(serviceId);
  const result = await client.query<ServiceRow>(
    `select s.id::text,s.organization_id::text,s.title,s.status,s.ai_enabled,s.auto_preview_threshold
       from services s
      where s.organization_id=$2
        and exists (
          select 1 from user_organization_roles uor
           where uor.user_id=$1 and uor.organization_id=s.organization_id
        )
        ${serviceFilter}
      order by case when s.status='live' then 0 when s.status='ready' then 1 else 2 end,
               s.updated_at desc,s.id desc
      ${forUpdate ? "for update of s" : ""}
      limit 1`,
    values
  );
  if (serviceId && !result.rowCount) {
    throw new AIDirectorError(404, "ai_director_service_not_found", "Service was not found in this church workspace");
  }
  return result.rows[0] ?? null;
}

function toObservedDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function workerHealth(row: WorkerRow | undefined, now: Date, label: string): AIDirectorHealth {
  const observed = toObservedDate(row?.observed_at);
  if (!row || !observed || now.getTime() - observed.getTime() > HEALTH_STALE_MS) {
    return { state: "offline", label, detail: "No fresh worker heartbeat", observedAt: observed?.toISOString() ?? null };
  }
  if (row.state === "ready") {
    return { state: "healthy", label, detail: `${row.provider} worker ready`, observedAt: observed.toISOString() };
  }
  return {
    state: "degraded",
    label,
    detail: row.error_code ? `${row.provider}: ${row.error_code}` : `${row.provider} worker ${row.state}`,
    observedAt: observed.toISOString()
  };
}

function asrHealth(row: MediaHealthRow | undefined, now: Date): AIDirectorHealth {
  const observed = toObservedDate(row?.last_seen_at);
  if (!row || !observed || now.getTime() - observed.getTime() > HEALTH_STALE_MS) {
    return { state: "offline", label: "Speech recognition", detail: "No fresh Edge audio telemetry", observedAt: observed?.toISOString() ?? null };
  }
  const metadata = row.metadata ?? {};
  const workerStatus = String(metadata.asrWorkerStatus ?? "").toLowerCase();
  const engine = String(metadata.asrWorkerEngine ?? "ASR");
  if ((row.status === "ready" || row.status === "live") && workerStatus === "ready") {
    return { state: "healthy", label: "Speech recognition", detail: `${engine} ready on ${row.name}`, observedAt: observed.toISOString() };
  }
  return {
    state: "degraded",
    label: "Speech recognition",
    detail: workerStatus ? `${engine} ${workerStatus}` : `Audio source ${row.status}`,
    observedAt: observed.toISOString()
  };
}

async function latestWorker(client: PoolClient, table: "translation_worker_status" | "tts_worker_status") {
  const result = await client.query<WorkerRow>(
    `select worker_id,provider,state,error_code,observed_at::text
       from ${table}
      order by observed_at desc,worker_id
      limit 1`
  );
  return result.rows[0];
}

async function entitlementAvailable(client: PoolClient, organizationId: string, now: Date) {
  try {
    await requireEntitlementFeature(organizationId, "ai.director", { client, now });
    return true;
  } catch (error) {
    if (error instanceof EntitlementAccessError) return false;
    throw error;
  }
}

export async function getAIDirectorState(
  client: PoolClient,
  userId: string,
  options: { organizationId: string; serviceId?: string | null; now?: Date }
): Promise<AIDirectorState> {
  const now = options.now ? new Date(options.now) : new Date();
  const roles = await membershipRoles(client, userId, options.organizationId);
  const service = await loadService(client, userId, options.organizationId, options.serviceId);
  const [audio, translation, tts, recommendations, entitled] = await Promise.all([
    client.query<MediaHealthRow>(
      `select name,status,last_seen_at::text,metadata
         from media_sources
        where organization_id=$1 and source_type='audio_input'
        order by last_seen_at desc nulls last,id desc
        limit 1`,
      [options.organizationId]
    ),
    latestWorker(client, "translation_worker_status"),
    latestWorker(client, "tts_worker_status"),
    service
      ? client.query<DetectionRow>(
          `select id::text,scripture_reference,confidence,state,detection_method,source_text,source_observed_at::text
             from scripture_detections
            where service_id=$1 and state <> 'dismissed'
            order by source_observed_at desc,source_ordinal desc,detected_at desc,id desc
            limit $2`,
          [service.id, RECOMMENDATION_LIMIT]
        )
      : Promise.resolve({ rows: [] as DetectionRow[] }),
    entitlementAvailable(client, options.organizationId, now)
  ]);

  return {
    organizationId: options.organizationId,
    service: service ? {
      id: service.id,
      title: service.title,
      status: service.status,
      aiEnabled: service.ai_enabled,
      autoPreviewThreshold: Number(service.auto_preview_threshold)
    } : null,
    health: {
      asr: asrHealth(audio.rows[0], now),
      translation: workerHealth(translation, now, "Translation"),
      tts: workerHealth(tts, now, "Voice translation")
    },
    recommendations: recommendations.rows.map((row) => ({
      id: row.id,
      reference: row.scripture_reference,
      confidence: Number(row.confidence),
      state: row.state,
      method: row.detection_method,
      evidence: row.source_text.trim().slice(0, 280),
      observedAt: row.source_observed_at
    })),
    canManageSettings: roles.some((role) => LIVE_OPERATOR_ROLES.includes(role)),
    entitled
  };
}

export async function updateAIDirectorSettings(
  client: PoolClient,
  userId: string,
  input: {
    organizationId: string;
    serviceId: string;
    aiEnabled: boolean;
    autoPreviewThreshold: number;
    now?: Date;
  }
) {
  const now = input.now ? new Date(input.now) : new Date();
  const roles = await membershipRoles(client, userId, input.organizationId);
  if (!roles.some((role) => LIVE_OPERATOR_ROLES.includes(role))) {
    throw new AIDirectorError(403, "ai_director_role_required", "Live operator permission is required to change AI Director settings");
  }
  if (!Number.isFinite(input.autoPreviewThreshold) || input.autoPreviewThreshold < MIN_THRESHOLD || input.autoPreviewThreshold > MAX_THRESHOLD) {
    throw new AIDirectorError(422, "ai_director_threshold_invalid", `Auto-preview threshold must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}`);
  }
  try {
    await requireEntitlementFeature(input.organizationId, "ai.director", { client, now });
  } catch (error) {
    if (error instanceof EntitlementAccessError) {
      throw new AIDirectorError(403, "ai_director_entitlement_required", "AI Director is not included in the current subscription");
    }
    throw error;
  }

  const service = await loadService(client, userId, input.organizationId, input.serviceId, true);
  if (!service) throw new AIDirectorError(404, "ai_director_service_not_found", "Service was not found");

  const result = await client.query<ServiceRow>(
    `update services
        set ai_enabled=$2,auto_preview_threshold=$3,updated_at=clock_timestamp()
      where id=$1
      returning id::text,organization_id::text,title,status,ai_enabled,auto_preview_threshold`,
    [input.serviceId, input.aiEnabled, input.autoPreviewThreshold]
  );
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'ai.director.settings.updated','service',$3,$4::jsonb)`,
    [input.organizationId, userId, input.serviceId, JSON.stringify({
      aiEnabled: input.aiEnabled,
      autoPreviewThreshold: input.autoPreviewThreshold,
      previousAiEnabled: service.ai_enabled,
      previousAutoPreviewThreshold: Number(service.auto_preview_threshold)
    })]
  );

  return {
    serviceId: result.rows[0].id,
    aiEnabled: result.rows[0].ai_enabled,
    autoPreviewThreshold: Number(result.rows[0].auto_preview_threshold)
  };
}
