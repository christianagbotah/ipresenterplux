import type { PoolClient } from "pg";
import { DEVICE_ADMIN_ROLES } from "./role-policy.js";
import {
  VISUAL_SOURCE_TYPES,
  reportedVisualSourceName,
  sanitizeVisualSourceMetadata,
  visualCaptureStatusCopy,
  visualSourceKind,
  type VisualCaptureStatus
} from "./visual-source-metadata.ts";

const CAMERA_SOURCE_TYPES = ["camera", "video_input", "video_capture"] as const;
const DEFAULT_STALE_AFTER_SECONDS = 120;

export type CameraSourceStatus = "available" | "disconnected" | "permission_required" | "unsupported";
export type VisualSourceStatus = CameraSourceStatus | "busy" | "error";

export class CameraSourceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CameraSourceError";
    this.status = status;
    this.code = code;
  }
}

type VisualSourceRow = {
  id: string;
  organization_id: string;
  name: string;
  source_type: string;
  source_key: string | null;
  source_status: string;
  last_seen_at: string | null;
  metadata: unknown;
  public_config: unknown;
  edge_device_id: string | null;
  edge_name: string | null;
  edge_platform: string | null;
  edge_status: string | null;
  edge_last_seen_at: string | null;
  edge_active_service_id: string | null;
  operator_label: string | null;
  preferred: boolean | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function booleanLike(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "available", "supported", "granted"].includes(normalized)) return true;
    if (["false", "no", "0", "planned", "unsupported", "denied"].includes(normalized)) return false;
  }
  return null;
}

function permissionRequired(metadata: Record<string, unknown>) {
  const value = metadata.permission ?? metadata.permissionStatus ?? metadata.cameraPermission;
  return typeof value === "string" && ["denied", "restricted", "not_determined", "permission_required"].includes(value.trim().toLowerCase());
}

function captureUnsupported(metadata: Record<string, unknown>) {
  const value = metadata.captureSupported ?? metadata.cameraCaptureSupported ?? metadata.supported;
  return booleanLike(value) === false;
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseTime(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function deriveVisualStatus(
  row: VisualSourceRow,
  captureStatus: VisualCaptureStatus | undefined,
  now: Date,
  staleAfterSeconds: number
): VisualSourceStatus {
  const rawMetadata = asObject(row.metadata);
  if (captureStatus === "unsupported" || captureUnsupported(rawMetadata)) return "unsupported";
  if (captureStatus === "permission_required" || permissionRequired(rawMetadata)) return "permission_required";

  const sourceSeen = parseTime(row.last_seen_at);
  const edgeSeen = parseTime(row.edge_last_seen_at);
  const cutoff = now.getTime() - staleAfterSeconds * 1000;
  const sourceStale = !sourceSeen || sourceSeen.getTime() < cutoff;
  const edgeStale = !edgeSeen || edgeSeen.getTime() < cutoff;
  const edgeUnavailable = row.edge_status !== "active";
  if (sourceStale || edgeStale || edgeUnavailable) return "disconnected";

  if (captureStatus === "busy") return "busy";
  if (captureStatus === "disconnected" || row.source_status === "offline") return "disconnected";
  if (captureStatus === "error" || row.source_status === "error") return "error";
  return "available";
}

function cameraCompatibleStatus(status: VisualSourceStatus): CameraSourceStatus {
  if (status === "busy" || status === "error") return "disconnected";
  return status;
}

async function rolesFor(client: PoolClient, userId: string, organizationId: string) {
  const result = await client.query<{ role_id: string }>(
    `select role_id
     from user_organization_roles
     where user_id=$1 and organization_id=$2
     order by role_id`,
    [userId, organizationId]
  );
  if (!result.rowCount) {
    throw new CameraSourceError(403, "camera_forbidden", "You cannot access cameras for this church workspace");
  }
  return result.rows.map((row) => row.role_id);
}

async function requireAdmin(client: PoolClient, userId: string, organizationId: string) {
  const roles = await rolesFor(client, userId, organizationId);
  if (!roles.some((role) => DEVICE_ADMIN_ROLES.includes(role))) {
    throw new CameraSourceError(403, "camera_admin_required", "Owner or administrator access is required to change camera preferences");
  }
}

async function requireCameraSource(client: PoolClient, organizationId: string, mediaSourceId: string) {
  const result = await client.query<{ id: string }>(
    `select id::text
     from media_sources
     where id=$1 and organization_id=$2
       and source_type = any($3::text[])
     limit 1`,
    [mediaSourceId, organizationId, [...CAMERA_SOURCE_TYPES]]
  );
  if (!result.rowCount) {
    throw new CameraSourceError(404, "camera_source_not_found", "Camera source was not found in this church workspace");
  }
}

export async function listVisualSources(
  client: PoolClient,
  userId: string,
  organizationId: string,
  options: { now?: Date; staleAfterSeconds?: number } = {}
) {
  await rolesFor(client, userId, organizationId);
  const now = options.now ? new Date(options.now) : new Date();
  const staleAfterSeconds = Math.max(30, Math.min(900, Math.trunc(options.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS)));

  const devices = await client.query<{ id: string; name: string; platform: string; status: string; last_seen_at: string | null; active_service_id: string | null }>(
    `select id::text,name,platform,status,last_seen_at::text,active_service_id::text
     from edge_devices
     where organization_id=$1 and status <> 'revoked'
     order by case status when 'active' then 0 when 'offline' then 1 else 2 end,last_seen_at desc nulls last,name,id`,
    [organizationId]
  );
  const sources = await client.query<VisualSourceRow>(
    `select ms.id::text,ms.organization_id::text,ms.name,ms.source_type,ms.source_key,
            ms.status as source_status,ms.last_seen_at::text,ms.metadata,ms.public_config,
            ed.id::text as edge_device_id,ed.name as edge_name,ed.platform as edge_platform,
            ed.status as edge_status,ed.last_seen_at::text as edge_last_seen_at,ed.active_service_id::text as edge_active_service_id,
            csp.operator_label,csp.preferred
     from media_sources ms
     left join edge_devices ed on ed.id=ms.edge_device_id and ed.organization_id=ms.organization_id
     left join camera_source_preferences csp
       on csp.organization_id=ms.organization_id and csp.media_source_id=ms.id
     where ms.organization_id=$1
       and ms.source_type = any($2::text[])
     order by coalesce(csp.preferred,false) desc,coalesce(nullif(csp.operator_label,''),ms.name),ms.id`,
    [organizationId, [...VISUAL_SOURCE_TYPES]]
  );

  return {
    hasPairedEdge: devices.rows.some((device) => device.status === "active" || device.status === "offline"),
    edgeDevices: devices.rows.map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      status: device.status,
      lastSeenAt: device.last_seen_at,
      activeServiceId: device.active_service_id
    })),
    staleAfterSeconds,
    sources: sources.rows.flatMap((row) => {
      const kind = visualSourceKind(row.source_type);
      if (!kind) return [];
      const metadata = sanitizeVisualSourceMetadata(row.metadata);
      const status = deriveVisualStatus(row, metadata.captureStatus, now, staleAfterSeconds);
      const captureStatus = metadata.captureStatus;
      const config = asObject(row.public_config);
      const reportedName = reportedVisualSourceName(row.metadata, row.name);
      const operatorLabel = kind === "camera" ? row.operator_label : null;
      return [{
        id: row.id,
        organizationId: row.organization_id,
        name: reportedName,
        operatorLabel,
        displayName: operatorLabel?.trim() || reportedName,
        kind,
        sourceType: row.source_type,
        sourceKey: row.source_key,
        sourceStatus: row.source_status,
        status,
        captureStatus,
        captureStatusLabel: visualCaptureStatusCopy(captureStatus),
        previewActive: metadata.previewActive ?? false,
        programActive: metadata.programActive ?? false,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        fps: metadata.fps ?? null,
        framesCaptured: metadata.framesCaptured ?? null,
        droppedFrames: metadata.droppedFrames ?? null,
        errorCode: metadata.errorCode ?? null,
        processName: metadata.processName ?? null,
        displayPrimary: metadata.displayPrimary ?? null,
        preferred: kind === "camera" && Boolean(row.preferred),
        lastSeenAt: row.last_seen_at,
        previewUrl: status === "available" ? safeHttpsUrl(config.previewUrl) : null,
        reportingDevice: row.edge_device_id ? {
          id: row.edge_device_id,
          name: row.edge_name,
          platform: row.edge_platform,
          status: row.edge_status,
          lastSeenAt: row.edge_last_seen_at,
          activeServiceId: row.edge_active_service_id
        } : null
      }];
    })
  };
}

export async function listCameraSources(
  client: PoolClient,
  userId: string,
  organizationId: string,
  options: { now?: Date; staleAfterSeconds?: number } = {}
) {
  const result = await listVisualSources(client, userId, organizationId, options);
  return {
    ...result,
    sources: result.sources
      .filter((source) => source.kind === "camera")
      .map((source) => ({ ...source, status: cameraCompatibleStatus(source.status) }))
  };
}

export async function setCameraPreference(
  client: PoolClient,
  userId: string,
  input: { organizationId: string; mediaSourceId: string; operatorLabel?: string | null; preferred?: boolean }
) {
  await requireAdmin(client, userId, input.organizationId);
  await requireCameraSource(client, input.organizationId, input.mediaSourceId);
  const label = input.operatorLabel?.trim().replace(/\s+/g, " ") || null;
  if (label && label.length > 160) {
    throw new CameraSourceError(422, "camera_label_invalid", "Camera label must be 160 characters or fewer");
  }
  const preferred = Boolean(input.preferred);
  if (preferred) {
    await client.query(
      `update camera_source_preferences
       set preferred=false,updated_by=$2,updated_at=clock_timestamp()
       where organization_id=$1 and preferred=true and media_source_id<>$3`,
      [input.organizationId, userId, input.mediaSourceId]
    );
  }
  await client.query(
    `insert into camera_source_preferences(organization_id,media_source_id,operator_label,preferred,updated_by,updated_at)
     values ($1,$2,$3,$4,$5,clock_timestamp())
     on conflict (organization_id,media_source_id) do update
     set operator_label=excluded.operator_label,preferred=excluded.preferred,
         updated_by=excluded.updated_by,updated_at=clock_timestamp()`,
    [input.organizationId, input.mediaSourceId, label, preferred, userId]
  );
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'camera.preference.updated','media_source',$3,$4::jsonb)`,
    [input.organizationId, userId, input.mediaSourceId, JSON.stringify({ operatorLabel: label, preferred })]
  );
  return { mediaSourceId: input.mediaSourceId, operatorLabel: label, preferred };
}

export async function clearCameraPreference(
  client: PoolClient,
  userId: string,
  input: { organizationId: string; mediaSourceId: string }
) {
  await requireAdmin(client, userId, input.organizationId);
  await requireCameraSource(client, input.organizationId, input.mediaSourceId);
  await client.query(
    `delete from camera_source_preferences where organization_id=$1 and media_source_id=$2`,
    [input.organizationId, input.mediaSourceId]
  );
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'camera.preference.cleared','media_source',$3,'{}'::jsonb)`,
    [input.organizationId, userId, input.mediaSourceId]
  );
  return { mediaSourceId: input.mediaSourceId, cleared: true };
}
