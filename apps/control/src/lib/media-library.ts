import type { PoolClient } from "pg";
import { normalizePlannerItem } from "./planner-item-normalize.ts";
import { parsePlannerItemInput } from "./planner-item-schemas.ts";
import { createPlannerItem } from "./planner-mutations.ts";
import { loadPlannerServiceDetail } from "./planner-service-queries.ts";
import { PLANNER_MUTATION_ROLES } from "./role-policy.js";

export type MediaLibraryItemType = "song" | "slide" | "media";
export type MediaPreviewEligibility = "eligible" | "native_only" | "unsupported" | "missing_source";

export class MediaLibraryError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MediaLibraryError";
    this.status = status;
    this.code = code;
  }
}

type MediaSourceRow = {
  id: string;
  organization_id: string;
  name: string;
  source_type: string;
  status: string;
  public_config: unknown;
};

type MediaLibraryRow = {
  id: string;
  organization_id: string;
  item_type: MediaLibraryItemType;
  title: string;
  planner_input: unknown;
  media_source_id: string | null;
  created_at: string;
  updated_at: string;
  source_name: string | null;
  source_type: string | null;
  source_status: string | null;
  source_public_config: unknown;
};

export type ListMediaLibraryOptions = {
  organizationId: string;
  search?: string | null;
  itemType?: MediaLibraryItemType | null;
  limit?: number;
  offset?: number;
};

export type CreateMediaLibraryInput = {
  organizationId: string;
  itemType: MediaLibraryItemType;
  input: unknown;
};

export type AddMediaItemToServiceInput = {
  libraryItemId: string;
  serviceId: string;
  expectedRevision: string;
  position?: number;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanSearch(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.slice(0, 160);
}

async function membershipRoles(client: PoolClient, userId: string, organizationId: string) {
  const result = await client.query<{ role_id: string }>(
    `select role_id
     from user_organization_roles
     where user_id=$1 and organization_id=$2
     order by role_id`,
    [userId, organizationId]
  );
  if (!result.rowCount) {
    throw new MediaLibraryError(403, "media_library_forbidden", "You cannot access this media library");
  }
  return result.rows.map((row) => row.role_id);
}

async function requireMutationRole(client: PoolClient, userId: string, organizationId: string) {
  const roles = await membershipRoles(client, userId, organizationId);
  if (!roles.some((role) => PLANNER_MUTATION_ROLES.includes(role))) {
    throw new MediaLibraryError(403, "media_library_forbidden", "You cannot modify this media library");
  }
}

async function loadOrganizationMediaSource(client: PoolClient, organizationId: string, sourceId: string) {
  const result = await client.query<MediaSourceRow>(
    `select id::text,organization_id::text,name,source_type,status,public_config
     from media_sources
     where id=$1 and organization_id=$2
     limit 1`,
    [sourceId, organizationId]
  );
  if (!result.rowCount) {
    throw new MediaLibraryError(404, "media_source_not_found", "Media source was not found in this church workspace");
  }
  return result.rows[0];
}

function sourcePreviewEligibility(input: Record<string, unknown>, source: Pick<MediaSourceRow, "source_type" | "public_config"> | null) {
  if (!source) {
    return { state: "missing_source" as const, reason: "The referenced media source is no longer available." };
  }
  const config = asObject(source.public_config);
  const requestedKind = typeof input.mediaKind === "string" ? input.mediaKind : "";
  if (config.nativeOnly === true) {
    return { state: "native_only" as const, reason: "This item belongs to the church Edge runtime and is not browser-previewable yet." };
  }
  const assetUrl = typeof config.assetUrl === "string" ? config.assetUrl : "";
  if (!assetUrl) {
    return { state: "native_only" as const, reason: "This source has no approved Control Plane asset URL; use it from Edge until synchronization is available." };
  }
  try {
    const url = new URL(assetUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe URL");
  } catch {
    return { state: "unsupported" as const, reason: "This source does not expose an approved HTTPS asset URL." };
  }
  if (typeof config.mediaKind === "string" && config.mediaKind !== requestedKind) {
    return { state: "unsupported" as const, reason: "The library media kind does not match its approved source metadata." };
  }
  if (!["image", "video", "audio"].includes(requestedKind)) {
    return { state: "unsupported" as const, reason: "This media type is not supported by the Phase 1 Preview pipeline." };
  }
  return { state: "eligible" as const, reason: null };
}

function mapLibraryRow(row: MediaLibraryRow) {
  const plannerInput = asObject(row.planner_input);
  const preview = row.item_type === "media"
    ? sourcePreviewEligibility(plannerInput, row.media_source_id ? {
        source_type: row.source_type ?? "unknown",
        public_config: row.source_public_config
      } : null)
    : { state: "eligible" as const, reason: null };
  return {
    id: row.id,
    organizationId: row.organization_id,
    itemType: row.item_type,
    title: row.title,
    plannerInput,
    mediaSourceId: row.media_source_id,
    source: row.media_source_id ? {
      id: row.media_source_id,
      name: row.source_name,
      type: row.source_type,
      status: row.source_status
    } : null,
    previewEligibility: preview.state,
    previewReason: preview.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const MEDIA_LIBRARY_SELECT = `select mli.id::text,mli.organization_id::text,mli.item_type,mli.title,mli.planner_input,
  mli.media_source_id::text,mli.created_at::text,mli.updated_at::text,
  ms.name as source_name,ms.source_type,ms.status as source_status,ms.public_config as source_public_config
 from media_library_items mli
 left join media_sources ms on ms.id=mli.media_source_id and ms.organization_id=mli.organization_id`;

export async function listMediaLibrary(client: PoolClient, userId: string, options: ListMediaLibraryOptions) {
  await membershipRoles(client, userId, options.organizationId);
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.min(10_000, Math.trunc(options.offset ?? 0)));
  const values: unknown[] = [options.organizationId];
  const where = ["mli.organization_id=$1"];
  const search = cleanSearch(options.search);
  if (search) {
    values.push(`%${search}%`);
    where.push(`(mli.title ilike $${values.length} or mli.planner_input::text ilike $${values.length})`);
  }
  if (options.itemType) {
    values.push(options.itemType);
    where.push(`mli.item_type=$${values.length}`);
  }
  values.push(limit, offset);
  const result = await client.query<MediaLibraryRow>(
    `${MEDIA_LIBRARY_SELECT}
     where ${where.join(" and ")}
     order by mli.updated_at desc,mli.id desc
     limit $${values.length - 1} offset $${values.length}`,
    values
  );
  return { items: result.rows.map(mapLibraryRow), limit, offset };
}

export async function createMediaLibraryItem(
  client: PoolClient,
  userId: string,
  input: CreateMediaLibraryInput
) {
  await requireMutationRole(client, userId, input.organizationId);
  const parsed = parsePlannerItemInput(input.itemType, input.input) as Record<string, unknown>;
  let title = String(parsed.title ?? "").trim();
  let mediaSourceId: string | null = null;

  if (input.itemType === "media") {
    mediaSourceId = String(parsed.sourceId ?? "");
    await loadOrganizationMediaSource(client, input.organizationId, mediaSourceId);
  } else {
    const normalized = await normalizePlannerItem(client, input.organizationId, input.itemType, parsed);
    title = normalized.title;
  }

  const inserted = await client.query<{ id: string }>(
    `insert into media_library_items(organization_id,item_type,title,planner_input,media_source_id,created_by,updated_at)
     values ($1,$2,$3,$4::jsonb,$5,$6,clock_timestamp())
     returning id::text`,
    [input.organizationId, input.itemType, title, JSON.stringify(parsed), mediaSourceId, userId]
  );
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'media.library.created','media_library_item',$3,$4::jsonb)`,
    [input.organizationId, userId, inserted.rows[0].id, JSON.stringify({ itemType: input.itemType, title })]
  );

  const loaded = await client.query<MediaLibraryRow>(
    `${MEDIA_LIBRARY_SELECT} where mli.id=$1 and mli.organization_id=$2 limit 1`,
    [inserted.rows[0].id, input.organizationId]
  );
  return mapLibraryRow(loaded.rows[0]);
}

async function loadLibraryItemForUser(client: PoolClient, userId: string, libraryItemId: string) {
  const result = await client.query<MediaLibraryRow>(
    `${MEDIA_LIBRARY_SELECT}
     where mli.id=$1
       and exists (
         select 1 from user_organization_roles uor
         where uor.user_id=$2 and uor.organization_id=mli.organization_id
       )
     limit 1`,
    [libraryItemId, userId]
  );
  if (!result.rowCount) {
    throw new MediaLibraryError(404, "media_library_not_found", "Media library item was not found");
  }
  return mapLibraryRow(result.rows[0]);
}

export async function addMediaItemToServiceRundown(
  client: PoolClient,
  userId: string,
  input: AddMediaItemToServiceInput
) {
  const libraryItem = await loadLibraryItemForUser(client, userId, input.libraryItemId);
  const service = await loadPlannerServiceDetail(client, userId, input.serviceId);
  if (service.service.organizationId !== libraryItem.organizationId) {
    throw new MediaLibraryError(404, "media_library_not_found", "Media library item was not found for this service");
  }
  if (libraryItem.previewEligibility !== "eligible") {
    throw new MediaLibraryError(409, "media_not_preview_eligible", libraryItem.previewReason ?? "This media item cannot enter Preview yet");
  }

  return createPlannerItem(client, userId, input.serviceId, input.expectedRevision, {
    itemType: libraryItem.itemType,
    input: libraryItem.plannerInput,
    position: input.position
  });
}
