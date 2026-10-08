import type { PoolClient } from "pg";
import { requireEntitlementFeature, EntitlementAccessError } from "./licensing/entitlement-access.ts";

type QueryClient = Pick<PoolClient, "query">;

export class ArchiveError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ArchiveError";
    this.status = status;
    this.code = code;
  }
}

type ArchiveFilters = {
  organizationId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

type ArchiveServiceRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  campus_name: string | null;
  title: string;
  service_type: string;
  scheduled_start: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type ArtifactRow = {
  id: string;
  organization_id: string;
  service_id: string;
  artifact_type: string;
  status: string;
  storage_kind: string;
  storage_locator: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function limitValue(value: number | undefined) {
  return Math.max(1, Math.min(100, Math.trunc(value ?? 30)));
}

function offsetValue(value: number | undefined) {
  return Math.max(0, Math.min(10_000, Math.trunc(value ?? 0)));
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function artifactPublic(row: ArtifactRow) {
  const metadata = metadataRecord(row.metadata);
  return {
    id: row.id,
    type: row.artifact_type,
    status: row.status,
    storageKind: row.storage_kind,
    label: typeof metadata.label === "string" ? metadata.label : row.artifact_type,
    requiredFeature: typeof metadata.requiredFeature === "string" ? metadata.requiredFeature : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listArchivedServices(client: QueryClient, userId: string, filters: ArchiveFilters = {}) {
  const values: unknown[] = [userId];
  const where = [
    "s.status='ended'",
    "exists (select 1 from user_organization_roles uor where uor.user_id=$1 and uor.organization_id=s.organization_id)"
  ];
  if (filters.organizationId) {
    values.push(filters.organizationId);
    where.push(`s.organization_id=$${values.length}::uuid`);
  }
  const search = filters.search?.trim();
  if (search) {
    values.push(`%${search}%`);
    where.push(`s.title ilike $${values.length}`);
  }
  values.push(limitValue(filters.limit));
  const limitIndex = values.length;
  values.push(offsetValue(filters.offset));
  const offsetIndex = values.length;

  const result = await client.query<ArchiveServiceRow>(
    `select s.id::text,s.organization_id::text,o.name as organization_name,c.name as campus_name,
            s.title,s.service_type,s.scheduled_start::text,s.started_at::text,s.ended_at::text
       from services s
       join organizations o on o.id=s.organization_id
       left join campuses c on c.id=s.campus_id and c.organization_id=s.organization_id
      where ${where.join(" and ")}
      order by s.ended_at desc nulls last,s.id desc
      limit $${limitIndex} offset $${offsetIndex}`,
    values
  );
  return {
    services: result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      campusName: row.campus_name,
      title: row.title,
      serviceType: row.service_type,
      scheduledStart: row.scheduled_start,
      startedAt: row.started_at,
      endedAt: row.ended_at
    })),
    limit: limitValue(filters.limit),
    offset: offsetValue(filters.offset)
  };
}

async function archivedServiceRow(client: QueryClient, userId: string, serviceId: string) {
  const result = await client.query<ArchiveServiceRow>(
    `select s.id::text,s.organization_id::text,o.name as organization_name,c.name as campus_name,
            s.title,s.service_type,s.scheduled_start::text,s.started_at::text,s.ended_at::text
       from services s
       join organizations o on o.id=s.organization_id
       left join campuses c on c.id=s.campus_id and c.organization_id=s.organization_id
      where s.id=$1::uuid and s.status='ended'
        and exists (select 1 from user_organization_roles uor where uor.user_id=$2 and uor.organization_id=s.organization_id)
      limit 1`,
    [serviceId, userId]
  );
  if (!result.rowCount) throw new ArchiveError(404, "archive_service_not_found", "Archived service was not found");
  return result.rows[0];
}

export async function getArchivedService(client: QueryClient, userId: string, serviceId: string) {
  const service = await archivedServiceRow(client, userId, serviceId);
  const [rundown, scripture, transcript, artifacts] = await Promise.all([
    client.query<{ id:string; item_type:string; title:string; content:Record<string,unknown>; sort_order:number; state:string }>(
      `select id::text,item_type,title,content,sort_order,state
         from presentation_items where service_id=$1::uuid
        order by sort_order,id`, [serviceId]),
    client.query<{ id:string; scripture_reference:string; confidence:string; state:string; detection_method:string; source_text:string; source_observed_at:string }>(
      `select id::text,scripture_reference,confidence::text,state,detection_method,source_text,source_observed_at::text
         from scripture_detections where service_id=$1::uuid
        order by source_observed_at,source_ordinal,detected_at,id`, [serviceId]),
    client.query<{ count:string; first_observed_at:string|null; last_observed_at:string|null; preview:string|null }>(
      `select count(*)::text as count,min(source_observed_at)::text as first_observed_at,
              max(source_observed_at)::text as last_observed_at,
              (array_agg(left(text,240) order by source_observed_at desc,id desc))[1] as preview
         from transcript_segments where service_id=$1::uuid`, [serviceId]),
    client.query<ArtifactRow>(
      `select id::text,organization_id::text,service_id::text,artifact_type,status,storage_kind,storage_locator,
              metadata,created_at::text,updated_at::text
         from service_artifacts where organization_id=$1::uuid and service_id=$2::uuid
        order by created_at desc,id desc`, [service.organization_id, serviceId])
  ]);

  return {
    service: {
      id: service.id,
      organizationId: service.organization_id,
      organizationName: service.organization_name,
      campusName: service.campus_name,
      title: service.title,
      serviceType: service.service_type,
      scheduledStart: service.scheduled_start,
      startedAt: service.started_at,
      endedAt: service.ended_at
    },
    rundown: rundown.rows.map((row) => ({ id: row.id, type: row.item_type, title: row.title, content: row.content, sortOrder: row.sort_order, state: row.state })),
    scriptureHistory: scripture.rows.map((row) => ({
      id: row.id,
      reference: row.scripture_reference,
      confidence: Number(row.confidence),
      state: row.state,
      method: row.detection_method,
      evidence: row.source_text,
      observedAt: row.source_observed_at
    })),
    transcript: {
      count: Number(transcript.rows[0]?.count ?? 0),
      firstObservedAt: transcript.rows[0]?.first_observed_at ?? null,
      lastObservedAt: transcript.rows[0]?.last_observed_at ?? null,
      preview: transcript.rows[0]?.preview ?? null
    },
    artifacts: artifacts.rows.map(artifactPublic)
  };
}

export async function resolveArchiveArtifactAccess(
  client: QueryClient,
  userId: string,
  serviceId: string,
  artifactId: string,
  options: { now?: Date } = {}
) {
  const service = await archivedServiceRow(client, userId, serviceId);
  const result = await client.query<ArtifactRow>(
    `select id::text,organization_id::text,service_id::text,artifact_type,status,storage_kind,storage_locator,
            metadata,created_at::text,updated_at::text
       from service_artifacts
      where id=$1::uuid and service_id=$2::uuid and organization_id=$3::uuid
      limit 1`,
    [artifactId, serviceId, service.organization_id]
  );
  const artifact = result.rows[0];
  if (!artifact) throw new ArchiveError(404, "archive_artifact_not_found", "Archive artifact was not found");

  if (artifact.status !== "available") {
    return { kind: "unavailable" as const, status: artifact.status, artifact: artifactPublic(artifact) };
  }
  if (artifact.storage_kind === "edge_local") {
    return { kind: "unavailable" as const, status: "edge_local_only", artifact: artifactPublic(artifact) };
  }

  const metadata = metadataRecord(artifact.metadata);
  const requiredFeature = typeof metadata.requiredFeature === "string" ? metadata.requiredFeature : "core.presentation";
  try {
    await requireEntitlementFeature(service.organization_id, requiredFeature, { client, now: options.now });
  } catch (error) {
    if (error instanceof EntitlementAccessError) {
      throw new ArchiveError(403, "archive_entitlement_required", "Subscription entitlement does not allow this archive artifact");
    }
    throw error;
  }

  if (artifact.storage_kind === "external" && artifact.storage_locator) {
    let url: URL;
    try { url = new URL(artifact.storage_locator); } catch { return { kind: "unavailable" as const, status: "invalid_locator", artifact: artifactPublic(artifact) }; }
    if (url.protocol !== "https:") return { kind: "unavailable" as const, status: "invalid_locator", artifact: artifactPublic(artifact) };
    return { kind: "redirect" as const, url: url.toString(), artifact: artifactPublic(artifact) };
  }

  return { kind: "unavailable" as const, status: artifact.storage_kind === "control_managed" ? "control_managed_unavailable" : "metadata_only", artifact: artifactPublic(artifact) };
}
