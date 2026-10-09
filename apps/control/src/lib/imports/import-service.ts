import type { Pool, PoolClient } from "pg";
import { createMediaLibraryItem } from "../media-library.ts";
import { createPlannerItem, deletePlannerItem } from "../planner-mutations.ts";
import { loadPlannerServiceDetail } from "../planner-service-queries.ts";
import { PLANNER_MUTATION_ROLES } from "../role-policy.js";
import type { PortableImportCandidate, PortableImportInput, PortableImportPreview } from "./contracts.ts";
import { parsePortableImport } from "./parsers.ts";

export type PortableDuplicatePolicy = "skip" | "import_copy";

export class PortableImportServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PortableImportServiceError";
    this.status = status;
    this.code = code;
  }
}

type QueryClient = Pick<PoolClient, "query">;

type PreviewInput = {
  organizationId: string;
  source: PortableImportInput;
};

type CommitInput = PreviewInput & {
  duplicatePolicy?: PortableDuplicatePolicy;
  targetServiceId?: string;
  expectedRevision?: string;
};

type BatchItemRow = {
  id: string;
  ordinal: number;
  entity_type: string | null;
  entity_id: string | null;
  entity_updated_at_snapshot: string | null;
  disposition: string;
  provenance: Record<string, unknown>;
};

async function requireMutationMembership(client: QueryClient, userId: string, organizationId: string) {
  const result = await client.query<{ role_id: string }>(
    `select role_id
       from user_organization_roles
      where user_id=$1 and organization_id=$2
      order by role_id`,
    [userId, organizationId]
  );
  if (!result.rowCount) {
    throw new PortableImportServiceError(403, "portable_import_forbidden", "You cannot import content into this church workspace");
  }
  if (!result.rows.some((row) => PLANNER_MUTATION_ROLES.includes(row.role_id))) {
    throw new PortableImportServiceError(403, "portable_import_forbidden", "You are not allowed to modify this church content library");
  }
}

function importedPlannerInput(candidate: PortableImportCandidate) {
  if (candidate.targetType !== "song") return candidate.input;
  const rawSections = Array.isArray(candidate.input.sections) ? candidate.input.sections : [];
  const sections = rawSections.map((raw) => {
    const section = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const label = typeof section.label === "string" ? section.label : "Section";
    if (typeof section.text === "string") return { label, text: section.text };
    const lines = Array.isArray(section.lines) ? section.lines.filter((line): line is string => typeof line === "string") : [];
    return { label, text: lines.join("\n") };
  });
  return { ...candidate.input, title: candidate.title, sections };
}

async function previousCommittedSource(client: QueryClient, organizationId: string, sourceFingerprint: string) {
  const result = await client.query<{ id: string }>(
    `select id::text
       from portable_import_batches
      where organization_id=$1 and source_fingerprint=$2 and status in ('committed','undo_blocked')
      order by committed_at desc,id desc
      limit 1`,
    [organizationId, sourceFingerprint]
  );
  return result.rows[0]?.id ?? null;
}

async function ensureTargetServiceScope(
  client: QueryClient,
  userId: string,
  organizationId: string,
  serviceId: string
) {
  const result = await client.query<{ organization_id: string }>(
    `select s.organization_id::text
       from services s
      where s.id=$1
        and s.organization_id=$2
        and exists (
          select 1 from user_organization_roles uor
          where uor.user_id=$3 and uor.organization_id=s.organization_id
        )
      limit 1`,
    [serviceId, organizationId, userId]
  );
  if (!result.rowCount) {
    throw new PortableImportServiceError(404, "portable_import_service_not_found", "Target service was not found in this church workspace");
  }
}

export async function previewPortableImport(
  client: QueryClient,
  userId: string,
  input: PreviewInput
): Promise<PortableImportPreview & { previousBatchId: string | null }> {
  await requireMutationMembership(client, userId, input.organizationId);
  const preview = parsePortableImport(input.source);
  const previousBatchId = await previousCommittedSource(client, input.organizationId, preview.sourceFingerprint);
  return { ...preview, previousBatchId };
}

async function insertBatch(
  client: PoolClient,
  userId: string,
  input: CommitInput,
  preview: PortableImportPreview,
  duplicatePolicy: PortableDuplicatePolicy
) {
  const inserted = await client.query<{ id: string }>(
    `insert into portable_import_batches
      (organization_id,created_by,source_kind,source_name,source_fingerprint,duplicate_policy,status,preview_summary,provenance,updated_at)
     values ($1,$2,$3,$4,$5,$6,'committed',$7::jsonb,$8::jsonb,clock_timestamp())
     returning id::text`,
    [
      input.organizationId,
      userId,
      preview.kind,
      preview.sourceName,
      preview.sourceFingerprint,
      duplicatePolicy,
      JSON.stringify(preview.summary),
      JSON.stringify({
        sourceName: preview.sourceName,
        sourceKind: preview.kind,
        sourceFingerprint: preview.sourceFingerprint,
        targetServiceId: input.targetServiceId ?? null
      })
    ]
  );
  return inserted.rows[0].id;
}

async function recordBatchItem(
  client: PoolClient,
  input: {
    batchId: string;
    organizationId: string;
    candidate: PortableImportCandidate;
    disposition: "created" | "skipped_duplicate" | "rejected";
    entityType?: string | null;
    entityId?: string | null;
    updatedAt?: string | null;
    provenance?: Record<string, unknown>;
  }
) {
  await client.query(
    `insert into portable_import_batch_items
      (batch_id,organization_id,ordinal,target_type,candidate_fingerprint,disposition,entity_type,entity_id,entity_updated_at_snapshot,provenance)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      input.batchId,
      input.organizationId,
      input.candidate.index,
      input.candidate.targetType,
      input.candidate.candidateFingerprint,
      input.disposition,
      input.entityType ?? null,
      input.entityId ?? null,
      input.updatedAt ?? null,
      JSON.stringify(input.provenance ?? {})
    ]
  );
}

async function ensurePortableMediaSource(
  client: PoolClient,
  input: { organizationId: string; candidate: PortableImportCandidate }
) {
  const url = String(input.candidate.input.url ?? "");
  const mediaKind = String(input.candidate.input.mediaType ?? "");
  const fingerprint = input.candidate.candidateFingerprint;
  const name = `Portable · ${input.candidate.title} · ${fingerprint.slice(0, 8)}`;
  const sourceKey = `portable:${fingerprint}`;
  const publicConfig = JSON.stringify({ assetUrl: url, mediaKind });
  const metadata = JSON.stringify({ origin: "portable_import", candidateFingerprint: fingerprint });
  const inserted = await client.query<{ id: string }>(
    `insert into media_sources
      (organization_id,name,source_type,status,public_config,source_key,last_seen_at,metadata)
     values ($1,$2,'portable_asset','ready',$3::jsonb,$4,clock_timestamp(),$5::jsonb)
     on conflict (organization_id,name) do nothing
     returning id::text`,
    [input.organizationId, name, publicConfig, sourceKey, metadata]
  );
  if (inserted.rowCount) {
    return { id: inserted.rows[0].id, created: true, sourceKey, url, mediaKind, fingerprint };
  }
  const updated = await client.query<{ id: string }>(
    `update media_sources
        set status='ready',public_config=$3::jsonb,source_key=$4,last_seen_at=clock_timestamp(),metadata=$5::jsonb
      where organization_id=$1 and name=$2
      returning id::text`,
    [input.organizationId, name, publicConfig, sourceKey, metadata]
  );
  if (!updated.rowCount) {
    throw new PortableImportServiceError(409, "portable_import_media_source_conflict", "Portable media source could not be resolved safely");
  }
  return { id: updated.rows[0].id, created: false, sourceKey, url, mediaKind, fingerprint };
}

async function entityTimestamp(client: PoolClient, table: "media_library_items" | "presentation_items", id: string) {
  const result = await client.query<{ updated_at: string }>(
    `select updated_at::text from ${table} where id=$1 limit 1`,
    [id]
  );
  return result.rows[0]?.updated_at ?? null;
}

async function auditImport(
  client: PoolClient,
  organizationId: string,
  userId: string,
  action: string,
  batchId: string,
  details: Record<string, unknown>
) {
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,$3,'portable_import_batch',$4,$5::jsonb)`,
    [organizationId, userId, action, batchId, JSON.stringify(details)]
  );
}

export async function commitPortableImport(pool: Pool, userId: string, input: CommitInput) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await requireMutationMembership(client, userId, input.organizationId);
    const preview = parsePortableImport(input.source);
    const previousBatchId = await previousCommittedSource(client, input.organizationId, preview.sourceFingerprint);
    if (previousBatchId && !input.duplicatePolicy) {
      throw new PortableImportServiceError(
        409,
        "portable_import_duplicate_policy_required",
        "This portable source was already committed. Choose Skip duplicates or Import copy explicitly."
      );
    }
    if (preview.summary.errors > 0) {
      throw new PortableImportServiceError(422, "portable_import_preview_errors", "Resolve import preview errors before committing this batch");
    }
    if (preview.kind === "service_rundown_json") {
      if (!input.targetServiceId || !input.expectedRevision) {
        throw new PortableImportServiceError(400, "portable_import_target_required", "Rundown imports require a target service and current planner revision");
      }
      await ensureTargetServiceScope(client, userId, input.organizationId, input.targetServiceId);
    }

    const duplicatePolicy: PortableDuplicatePolicy = input.duplicatePolicy ?? "import_copy";
    const batchId = await insertBatch(client, userId, input, preview, duplicatePolicy);
    let created = 0;
    let skipped = 0;

    if (previousBatchId && duplicatePolicy === "skip") {
      for (const item of preview.candidates) {
        if (item.status === "error") continue;
        await recordBatchItem(client, {
          batchId,
          organizationId: input.organizationId,
          candidate: item,
          disposition: "skipped_duplicate",
          provenance: { previousBatchId }
        });
        skipped += 1;
      }
    } else if (preview.kind === "service_rundown_json") {
      let revision = input.expectedRevision!;
      for (const item of preview.candidates) {
        if (item.status === "duplicate") {
          await recordBatchItem(client, { batchId, organizationId: input.organizationId, candidate: item, disposition: "skipped_duplicate" });
          skipped += 1;
          continue;
        }
        const result = await createPlannerItem(client, userId, input.targetServiceId!, revision, {
          itemType: item.targetType,
          input: importedPlannerInput(item)
        });
        revision = result.revision;
        const updatedAt = await entityTimestamp(client, "presentation_items", result.item.id);
        await recordBatchItem(client, {
          batchId,
          organizationId: input.organizationId,
          candidate: item,
          disposition: "created",
          entityType: "presentation_item",
          entityId: result.item.id,
          updatedAt,
          provenance: { serviceId: input.targetServiceId }
        });
        created += 1;
      }
    } else {
      for (const item of preview.candidates) {
        if (item.status === "duplicate") {
          await recordBatchItem(client, { batchId, organizationId: input.organizationId, candidate: item, disposition: "skipped_duplicate" });
          skipped += 1;
          continue;
        }
        let plannerInput = importedPlannerInput(item);
        let portableMediaSource: Awaited<ReturnType<typeof ensurePortableMediaSource>> | null = null;
        if (preview.kind === "media_url_manifest") {
          portableMediaSource = await ensurePortableMediaSource(client, { organizationId: input.organizationId, candidate: item });
          plannerInput = {
            title: item.title,
            sourceId: portableMediaSource.id,
            mediaKind: String(item.input.mediaType ?? "")
          };
        }
        const createdItem = await createMediaLibraryItem(client, userId, {
          organizationId: input.organizationId,
          itemType: item.targetType as "song" | "slide" | "media",
          input: plannerInput
        });
        await recordBatchItem(client, {
          batchId,
          organizationId: input.organizationId,
          candidate: item,
          disposition: "created",
          entityType: "media_library_item",
          entityId: createdItem.id,
          updatedAt: createdItem.updatedAt,
          provenance: {
            itemType: createdItem.itemType,
            ...(portableMediaSource ? {
              mediaSourceId: portableMediaSource.id,
              mediaSourceCreated: portableMediaSource.created,
              mediaSourceKey: portableMediaSource.sourceKey,
              mediaSourceUrl: portableMediaSource.url,
              mediaSourceKind: portableMediaSource.mediaKind,
              mediaSourceFingerprint: portableMediaSource.fingerprint
            } : {})
          }
        });
        created += 1;
      }
    }

    await auditImport(client, input.organizationId, userId, "portable_import.committed", batchId, {
      sourceKind: preview.kind,
      sourceFingerprint: preview.sourceFingerprint,
      duplicatePolicy,
      created,
      skipped,
      targetServiceId: input.targetServiceId ?? null
    });
    await client.query("commit");
    return { batchId, created, skipped, sourceFingerprint: preview.sourceFingerprint, duplicatePolicy };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function loadUndoBatch(client: PoolClient, userId: string, batchId: string) {
  const batchResult = await client.query<{
    id: string;
    organization_id: string;
    status: string;
  }>(
    `select b.id::text,b.organization_id::text,b.status
       from portable_import_batches b
      where b.id=$1
        and exists (
          select 1 from user_organization_roles uor
          where uor.user_id=$2 and uor.organization_id=b.organization_id
        )
      for update
      limit 1`,
    [batchId, userId]
  );
  if (!batchResult.rowCount) {
    throw new PortableImportServiceError(404, "portable_import_batch_not_found", "Portable import batch was not found");
  }
  const batch = batchResult.rows[0];
  await requireMutationMembership(client, userId, batch.organization_id);
  const items = await client.query<BatchItemRow>(
    `select id::text,ordinal,entity_type,entity_id,entity_updated_at_snapshot::text,disposition,provenance
       from portable_import_batch_items
      where batch_id=$1 and organization_id=$2
      order by ordinal desc,id desc`,
    [batchId, batch.organization_id]
  );
  return { batch, items: items.rows };
}

async function undoConflicts(client: PoolClient, items: BatchItemRow[]) {
  const conflicts: Array<{ itemId: string; reason: string }> = [];
  for (const item of items) {
    if (item.disposition !== "created" || !item.entity_id || !item.entity_type) continue;
    if (item.entity_type === "media_library_item") {
      const found = await client.query<{ unchanged: boolean }>(
        `select updated_at=$2::timestamptz as unchanged
           from media_library_items
          where id=$1
          limit 1`,
        [item.entity_id, item.entity_updated_at_snapshot]
      );
      if (!found.rowCount || !found.rows[0].unchanged) {
        conflicts.push({ itemId: item.id, reason: "library_item_changed" });
        continue;
      }
      const provenance = item.provenance ?? {};
      const mediaSourceId = typeof provenance.mediaSourceId === "string" ? provenance.mediaSourceId : null;
      if (provenance.mediaSourceCreated === true && mediaSourceId) {
        const source = await client.query<{ source_key: string | null; public_config: Record<string, unknown>; metadata: Record<string, unknown>; reused: boolean }>(
          `select ms.source_key,ms.public_config,ms.metadata,
                  exists(select 1 from media_library_items other where other.media_source_id=ms.id and other.id<>$2::uuid) as reused
             from media_sources ms
            where ms.id=$1
              and ms.organization_id=(select organization_id from media_library_items where id=$2::uuid)
            for update of ms`,
          [mediaSourceId, item.entity_id]
        );
        if (source.rowCount) {
          const row = source.rows[0];
          const expectedKey = typeof provenance.mediaSourceKey === "string" ? provenance.mediaSourceKey : null;
          const expectedUrl = typeof provenance.mediaSourceUrl === "string" ? provenance.mediaSourceUrl : null;
          const expectedKind = typeof provenance.mediaSourceKind === "string" ? provenance.mediaSourceKind : null;
          const expectedFingerprint = typeof provenance.mediaSourceFingerprint === "string" ? provenance.mediaSourceFingerprint : null;
          if (row.reused) conflicts.push({ itemId: item.id, reason: "media_source_used" });
          else if (
            !expectedKey || row.source_key !== expectedKey ||
            row.metadata?.origin !== "portable_import" ||
            row.metadata?.candidateFingerprint !== expectedFingerprint ||
            row.public_config?.assetUrl !== expectedUrl ||
            row.public_config?.mediaKind !== expectedKind
          ) conflicts.push({ itemId: item.id, reason: "media_source_changed" });
        }
      }
    } else if (item.entity_type === "presentation_item") {
      const found = await client.query<{ unchanged: boolean; state: string }>(
        `select updated_at=$2::timestamptz as unchanged,state
           from presentation_items
          where id=$1
          limit 1`,
        [item.entity_id, item.entity_updated_at_snapshot]
      );
      if (!found.rowCount || !found.rows[0].unchanged || found.rows[0].state !== "queued") {
        conflicts.push({ itemId: item.id, reason: !found.rowCount ? "planner_item_missing" : found.rows[0].state !== "queued" ? "planner_item_used" : "planner_item_changed" });
      }
    }
  }
  return conflicts;
}

async function markUndoBlocked(
  client: PoolClient,
  organizationId: string,
  userId: string,
  batchId: string,
  conflicts: Array<{ itemId: string; reason: string }>
) {
  await client.query(
    `update portable_import_batches set status='undo_blocked',updated_at=clock_timestamp() where id=$1 and organization_id=$2`,
    [batchId, organizationId]
  );
  await auditImport(client, organizationId, userId, "portable_import.undo_blocked", batchId, { conflicts });
}

export async function undoPortableImport(pool: Pool, userId: string, batchId: string) {
  const client = await pool.connect();
  let blocked: PortableImportServiceError | null = null;
  try {
    await client.query("begin");
    const { batch, items } = await loadUndoBatch(client, userId, batchId);
    if (batch.status === "undone") {
      await client.query("commit");
      return { batchId, status: "undone" as const, idempotent: true };
    }

    const conflicts = await undoConflicts(client, items);
    if (conflicts.length) {
      await markUndoBlocked(client, batch.organization_id, userId, batchId, conflicts);
      await client.query("commit");
      blocked = new PortableImportServiceError(409, "portable_import_undo_conflict", "Imported content changed or was used after import; automatic undo was blocked to protect later work");
    } else {
      for (const item of items) {
        if (item.disposition !== "created" || !item.entity_id || !item.entity_type) continue;
        if (item.entity_type === "presentation_item") {
          const target = await client.query<{ service_id: string }>(
            `select service_id::text from presentation_items where id=$1 limit 1`,
            [item.entity_id]
          );
          if (target.rowCount) {
            const detail = await loadPlannerServiceDetail(client, userId, target.rows[0].service_id);
            await deletePlannerItem(client, userId, target.rows[0].service_id, item.entity_id, detail.revision);
          }
        } else if (item.entity_type === "media_library_item") {
          const deleted = await client.query(
            `delete from media_library_items
              where id=$1 and organization_id=$2 and updated_at=$3::timestamptz`,
            [item.entity_id, batch.organization_id, item.entity_updated_at_snapshot]
          );
          if (!deleted.rowCount) {
            throw new PortableImportServiceError(409, "portable_import_undo_conflict", "Imported library item changed before undo could complete");
          }
          const provenance = item.provenance ?? {};
          const mediaSourceId = typeof provenance.mediaSourceId === "string" ? provenance.mediaSourceId : null;
          if (provenance.mediaSourceCreated === true && mediaSourceId) {
            const sourceKey = typeof provenance.mediaSourceKey === "string" ? provenance.mediaSourceKey : "";
            const sourceUrl = typeof provenance.mediaSourceUrl === "string" ? provenance.mediaSourceUrl : "";
            const sourceKind = typeof provenance.mediaSourceKind === "string" ? provenance.mediaSourceKind : "";
            const sourceFingerprint = typeof provenance.mediaSourceFingerprint === "string" ? provenance.mediaSourceFingerprint : "";
            await client.query(
              `delete from media_sources ms
                where ms.id=$1 and ms.organization_id=$2 and ms.source_type='portable_asset'
                  and ms.source_key=$3 and ms.metadata->>'origin'='portable_import'
                  and ms.metadata->>'candidateFingerprint'=$4
                  and ms.public_config->>'assetUrl'=$5 and ms.public_config->>'mediaKind'=$6
                  and not exists(select 1 from media_library_items other where other.media_source_id=ms.id)`,
              [mediaSourceId, batch.organization_id, sourceKey, sourceFingerprint, sourceUrl, sourceKind]
            );
          }
        }
        await client.query(
          `update portable_import_batch_items set disposition='undone',undone_at=clock_timestamp() where id=$1`,
          [item.id]
        );
      }
      await client.query(
        `update portable_import_batches set status='undone',undone_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and organization_id=$2`,
        [batchId, batch.organization_id]
      );
      await auditImport(client, batch.organization_id, userId, "portable_import.undone", batchId, { createdItemsUndone: items.filter((item) => item.disposition === "created").length });
      await client.query("commit");
    }
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (blocked) throw blocked;
  return { batchId, status: "undone" as const, idempotent: false };
}
