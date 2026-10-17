import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const MAX_STORAGE_NAME_LENGTH = 160;
const UNIQUE_VIOLATION = "23505";

type PersistedMediaSourceRow = {
  id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  metadata: unknown;
};

export type EdgeMediaSourceUpsertInput = {
  organizationId: string;
  deviceId: string;
  sourceKey: string;
  reportedName: string;
  sourceType: string;
  status: "offline" | "ready" | "live" | "warning" | "error";
  observedAt: Date | string;
  metadata: Record<string, unknown>;
  publicConfig: Record<string, unknown>;
};

export type EdgeMediaSourceUpsertResult = {
  id: string;
  status: string;
  storageName: string;
  reportedName: string;
  lastSeenAt: string | null;
  applied: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeReportedName(value: string) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) throw new Error("visual_source_reported_name_required");
  return normalized.slice(0, MAX_STORAGE_NAME_LENGTH);
}

function collisionStorageName(reportedName: string, deviceId: string, sourceKey: string, attempt = 0) {
  const device = deviceId.replaceAll("-", "").slice(0, 8).toLowerCase();
  const digest = createHash("sha256")
    .update(`${deviceId}\u0000${sourceKey}`)
    .digest("hex")
    .slice(0, 10);
  const retry = attempt > 0 ? `-${attempt}` : "";
  const suffix = ` · ${device}-${digest}${retry}`;
  const prefixLength = Math.max(1, MAX_STORAGE_NAME_LENGTH - suffix.length);
  return `${reportedName.slice(0, prefixLength).trimEnd()}${suffix}`;
}

function resultFromRow(row: PersistedMediaSourceRow, applied: boolean, fallbackReportedName: string): EdgeMediaSourceUpsertResult {
  const metadata = asObject(row.metadata);
  const reportedName = typeof metadata.reportedName === "string" && metadata.reportedName.trim()
    ? metadata.reportedName.trim()
    : fallbackReportedName;
  return {
    id: row.id,
    status: row.status,
    storageName: row.name,
    reportedName,
    lastSeenAt: row.last_seen_at,
    applied
  };
}

async function findStableSource(
  client: PoolClient,
  organizationId: string,
  deviceId: string,
  sourceKey: string,
  forUpdate = false
) {
  return client.query<PersistedMediaSourceRow>(
    `select id::text,name,status,last_seen_at::text,metadata
       from media_sources
      where organization_id=$1 and edge_device_id=$2 and source_key=$3
      limit 1${forUpdate ? " for update" : ""}`,
    [organizationId, deviceId, sourceKey]
  );
}

async function updateExisting(
  client: PoolClient,
  row: PersistedMediaSourceRow,
  input: EdgeMediaSourceUpsertInput,
  reportedName: string,
  observedAt: Date
) {
  const previousSeenAt = row.last_seen_at ? new Date(row.last_seen_at) : null;
  if (previousSeenAt && observedAt.getTime() < previousSeenAt.getTime()) {
    return resultFromRow(row, false, reportedName);
  }

  const metadata = { ...input.metadata, reportedName };
  const updated = await client.query<PersistedMediaSourceRow>(
    `update media_sources
        set source_type=$2,
            status=$3,
            last_seen_at=$4::timestamptz,
            metadata=$5::jsonb,
            public_config=public_config || $6::jsonb
      where id=$1
      returning id::text,name,status,last_seen_at::text,metadata`,
    [
      row.id,
      input.sourceType,
      input.status,
      observedAt.toISOString(),
      JSON.stringify(metadata),
      JSON.stringify(input.publicConfig)
    ]
  );
  return resultFromRow(updated.rows[0], true, reportedName);
}

async function nameIsUsed(client: PoolClient, organizationId: string, name: string) {
  const result = await client.query(
    `select 1 from media_sources where organization_id=$1 and name=$2 limit 1`,
    [organizationId, name]
  );
  return Boolean(result.rowCount);
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === UNIQUE_VIOLATION);
}

export async function upsertEdgeMediaSource(
  client: PoolClient,
  input: EdgeMediaSourceUpsertInput
): Promise<EdgeMediaSourceUpsertResult> {
  const reportedName = normalizeReportedName(input.reportedName);
  const observedAt = input.observedAt instanceof Date ? new Date(input.observedAt) : new Date(input.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("visual_source_observed_at_invalid");

  const existing = await findStableSource(client, input.organizationId, input.deviceId, input.sourceKey, true);
  if (existing.rowCount) {
    return updateExisting(client, existing.rows[0], input, reportedName, observedAt);
  }

  const reportedMetadata = { ...input.metadata, reportedName };
  let storageName = await nameIsUsed(client, input.organizationId, reportedName)
    ? collisionStorageName(reportedName, input.deviceId, input.sourceKey)
    : reportedName;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const inserted = await client.query<PersistedMediaSourceRow>(
        `insert into media_sources
          (organization_id,name,source_type,status,edge_device_id,source_key,last_seen_at,metadata,public_config)
         values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::jsonb,$9::jsonb)
         returning id::text,name,status,last_seen_at::text,metadata`,
        [
          input.organizationId,
          storageName,
          input.sourceType,
          input.status,
          input.deviceId,
          input.sourceKey,
          observedAt.toISOString(),
          JSON.stringify(reportedMetadata),
          JSON.stringify(input.publicConfig)
        ]
      );
      return resultFromRow(inserted.rows[0], true, reportedName);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // A concurrent event for this physical source may have won the stable tuple race.
      const concurrent = await findStableSource(client, input.organizationId, input.deviceId, input.sourceKey, true);
      if (concurrent.rowCount) {
        return updateExisting(client, concurrent.rows[0], input, reportedName, observedAt);
      }

      // Otherwise the legacy organization/name constraint raced us. Keep that constraint
      // intact and retry with a deterministic, bounded internal storage name.
      storageName = collisionStorageName(reportedName, input.deviceId, input.sourceKey, attempt + 1);
    }
  }

  throw new Error("visual_source_storage_name_allocation_failed");
}
