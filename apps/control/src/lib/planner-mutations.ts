import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { PLANNER_MAX_ITEMS } from "./planner-contracts.ts";
import { normalizePlannerItem } from "./planner-item-normalize.ts";
import { PLANNER_MUTATION_ROLES } from "./role-policy.js";
import {
  PlannerServiceError,
  loadPlannerServiceDetail
} from "./planner-service-queries.ts";

export type LockedPlannerService = {
  id: string;
  organizationId: string;
  campusId: string | null;
  status: string;
  activeBibleVersion: string;
  updatedAt: string;
};

export type PlannerItemMutationInput = {
  itemType: string;
  input: unknown;
  position?: number;
};

function hashOrder(ids: readonly string[]) {
  return createHash("sha256").update(ids.join("\u001f")).digest("hex").slice(0, 24);
}

async function rolesForOrganization(client: PoolClient, userId: string, organizationId: string) {
  const result = await client.query<{ role_id: string }>(
    `select role_id
     from user_organization_roles
     where user_id=$1 and organization_id=$2
     order by role_id`,
    [userId, organizationId]
  );
  return result.rows.map((row) => row.role_id);
}

export async function lockEditablePlannerService(
  client: PoolClient,
  userId: string,
  serviceId: string
): Promise<LockedPlannerService> {
  const serviceResult = await client.query<{
    id: string;
    organization_id: string;
    campus_id: string | null;
    status: string;
    active_bible_version: string;
    updated_at: string;
  }>(
    `select s.id::text,s.organization_id::text,s.campus_id::text,s.status,
            s.active_bible_version,s.updated_at::text
     from services s
     where s.id=$1
       and exists (
         select 1 from user_organization_roles uor
         where uor.user_id=$2 and uor.organization_id=s.organization_id
       )
     for update
     limit 1`,
    [serviceId, userId]
  );
  if (!serviceResult.rowCount) {
    throw new PlannerServiceError(404, "service_not_found", "Service not found");
  }
  const row = serviceResult.rows[0];
  const roles = await rolesForOrganization(client, userId, row.organization_id);
  if (!roles.some((role) => PLANNER_MUTATION_ROLES.includes(role))) {
    throw new PlannerServiceError(403, "planner_forbidden", "You are not allowed to modify service plans");
  }
  if (row.status !== "draft" && row.status !== "ready") {
    throw new PlannerServiceError(409, "service_not_editable", "Service is not editable in its current state");
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    campusId: row.campus_id,
    status: row.status,
    activeBibleVersion: row.active_bible_version,
    updatedAt: row.updated_at
  };
}

export async function assertPlannerRevision(
  client: PoolClient,
  userId: string,
  serviceId: string,
  expectedRevision: string
) {
  if (!expectedRevision) {
    throw new PlannerServiceError(428, "planner_revision_required", "Planner revision is required");
  }
  const detail = await loadPlannerServiceDetail(client, userId, serviceId);
  if (detail.revision !== expectedRevision) {
    throw new PlannerServiceError(409, "planner_revision_conflict", "Service plan changed; refresh before saving");
  }
  return detail;
}

export async function touchPlannerService(
  client: PoolClient,
  service: LockedPlannerService
) {
  const nextStatus = service.status === "ready" ? "draft" : service.status;
  await client.query(
    `update services
     set status=$2,updated_at=clock_timestamp()
     where id=$1`,
    [service.id, nextStatus]
  );

  let edgeAssignmentsCleared = 0;
  if (service.status === "ready") {
    const cleared = await client.query(
      `update edge_devices
       set active_service_id=null,updated_at=clock_timestamp()
       where organization_id=$1 and active_service_id=$2`,
      [service.organizationId, service.id]
    );
    edgeAssignmentsCleared = cleared.rowCount ?? 0;
  }

  return { fromStatus: service.status, toStatus: nextStatus, edgeAssignmentsCleared };
}

async function auditItemMutation(
  client: PoolClient,
  organizationId: string,
  userId: string,
  action: string,
  serviceId: string,
  details: Record<string, unknown>
) {
  const bounded: Record<string, unknown> = { serviceId };
  for (const [key, value] of Object.entries(details).slice(0, 16)) {
    if (typeof value === "string") bounded[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) bounded[key] = value;
  }
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,$3,'service',$4,$5::jsonb)`,
    [organizationId, userId, action, serviceId, JSON.stringify(bounded)]
  );
}

async function orderedItemIds(client: PoolClient, serviceId: string) {
  const result = await client.query<{ id: string }>(
    `select id::text from presentation_items where service_id=$1 order by sort_order,id`,
    [serviceId]
  );
  return result.rows.map((row) => row.id);
}

async function applyOrder(client: PoolClient, serviceId: string, ids: readonly string[]) {
  for (let index = 0; index < ids.length; index += 1) {
    await client.query(
      `update presentation_items
       set sort_order=$3,updated_at=clock_timestamp()
       where service_id=$1 and id=$2`,
      [serviceId, ids[index], -1_000_000 - index]
    );
  }
  for (let index = 0; index < ids.length; index += 1) {
    await client.query(
      `update presentation_items
       set sort_order=$3,updated_at=clock_timestamp()
       where service_id=$1 and id=$2`,
      [serviceId, ids[index], (index + 1) * 1000]
    );
  }
}

async function findServiceItem(client: PoolClient, serviceId: string, itemId: string) {
  const result = await client.query<{
    id: string;
    item_type: string;
    title: string;
    content: Record<string, unknown>;
    sort_order: number;
    state: string;
  }>(
    `select id::text,item_type,title,content,sort_order,state
     from presentation_items
     where service_id=$1 and id=$2
     limit 1`,
    [serviceId, itemId]
  );
  if (!result.rowCount) {
    throw new PlannerServiceError(404, "planner_item_not_found", "Planner item not found");
  }
  return result.rows[0];
}

export async function createPlannerItem(
  client: PoolClient,
  userId: string,
  serviceId: string,
  expectedRevision: string,
  input: PlannerItemMutationInput
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  const detail = await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  if (detail.items.length >= PLANNER_MAX_ITEMS) {
    throw new PlannerServiceError(409, "planner_item_limit", `A service cannot exceed ${PLANNER_MAX_ITEMS} rundown items`);
  }

  const normalized = await normalizePlannerItem(
    client,
    service.organizationId,
    input.itemType,
    input.input,
    { defaultBibleVersion: service.activeBibleVersion }
  );
  const currentIds = detail.items.map((item) => item.id);
  const sortOrder = (detail.items.at(-1)?.sortOrder ?? 0) + 1000;
  const inserted = await client.query<{ id: string }>(
    `insert into presentation_items(service_id,item_type,title,content,sort_order,state,updated_at)
     values ($1,$2,$3,$4::jsonb,$5,'queued',clock_timestamp())
     returning id::text`,
    [serviceId, input.itemType, normalized.title, JSON.stringify(normalized.content), sortOrder]
  );
  const itemId = inserted.rows[0].id;

  if (input.position !== undefined) {
    const position = Math.max(0, Math.min(currentIds.length, Math.trunc(input.position)));
    currentIds.splice(position, 0, itemId);
    await applyOrder(client, serviceId, currentIds);
  }

  const touched = await touchPlannerService(client, service);
  await auditItemMutation(client, service.organizationId, userId, "planner.item.created", serviceId, {
    itemId,
    itemType: input.itemType,
    title: normalized.title,
    fromStatus: touched.fromStatus,
    toStatus: touched.toStatus,
    edgeAssignmentsCleared: touched.edgeAssignmentsCleared
  });
  const updatedDetail = await loadPlannerServiceDetail(client, userId, serviceId);
  return {
    item: updatedDetail.items.find((item) => item.id === itemId)!,
    revision: updatedDetail.revision,
    service: updatedDetail.service,
    edgeAssignment: updatedDetail.edgeAssignment
  };
}

export async function updatePlannerItem(
  client: PoolClient,
  userId: string,
  serviceId: string,
  itemId: string,
  expectedRevision: string,
  input: Omit<PlannerItemMutationInput, "position">
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  await findServiceItem(client, serviceId, itemId);
  const normalized = await normalizePlannerItem(
    client,
    service.organizationId,
    input.itemType,
    input.input,
    { defaultBibleVersion: service.activeBibleVersion }
  );
  await client.query(
    `update presentation_items
     set item_type=$3,title=$4,content=$5::jsonb,updated_at=clock_timestamp()
     where service_id=$1 and id=$2`,
    [serviceId, itemId, input.itemType, normalized.title, JSON.stringify(normalized.content)]
  );
  const touched = await touchPlannerService(client, service);
  await auditItemMutation(client, service.organizationId, userId, "planner.item.updated", serviceId, {
    itemId,
    itemType: input.itemType,
    title: normalized.title,
    fromStatus: touched.fromStatus,
    toStatus: touched.toStatus,
    edgeAssignmentsCleared: touched.edgeAssignmentsCleared
  });
  const updatedDetail = await loadPlannerServiceDetail(client, userId, serviceId);
  return {
    item: updatedDetail.items.find((item) => item.id === itemId)!,
    revision: updatedDetail.revision,
    service: updatedDetail.service,
    edgeAssignment: updatedDetail.edgeAssignment
  };
}

export async function deletePlannerItem(
  client: PoolClient,
  userId: string,
  serviceId: string,
  itemId: string,
  expectedRevision: string
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  const existing = await findServiceItem(client, serviceId, itemId);
  await client.query(`delete from presentation_items where service_id=$1 and id=$2`, [serviceId, itemId]);
  const remaining = await orderedItemIds(client, serviceId);
  if (remaining.length) await applyOrder(client, serviceId, remaining);
  const touched = await touchPlannerService(client, service);
  await auditItemMutation(client, service.organizationId, userId, "planner.item.deleted", serviceId, {
    itemId,
    itemType: existing.item_type,
    title: existing.title,
    fromStatus: touched.fromStatus,
    toStatus: touched.toStatus,
    edgeAssignmentsCleared: touched.edgeAssignmentsCleared
  });
  const updatedDetail = await loadPlannerServiceDetail(client, userId, serviceId);
  return {
    deletedItemId: itemId,
    items: updatedDetail.items,
    revision: updatedDetail.revision,
    service: updatedDetail.service,
    edgeAssignment: updatedDetail.edgeAssignment
  };
}

export async function duplicatePlannerItem(
  client: PoolClient,
  userId: string,
  serviceId: string,
  itemId: string,
  expectedRevision: string
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  const detail = await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  if (detail.items.length >= PLANNER_MAX_ITEMS) {
    throw new PlannerServiceError(409, "planner_item_limit", `A service cannot exceed ${PLANNER_MAX_ITEMS} rundown items`);
  }
  const source = await findServiceItem(client, serviceId, itemId);
  const inserted = await client.query<{ id: string }>(
    `insert into presentation_items(service_id,item_type,title,content,sort_order,state,updated_at)
     values ($1,$2,$3,$4::jsonb,$5,$6,clock_timestamp())
     returning id::text`,
    [serviceId, source.item_type, source.title, JSON.stringify(source.content), source.sort_order + 1, source.state]
  );
  const duplicateId = inserted.rows[0].id;
  const order = detail.items.map((item) => item.id);
  const sourceIndex = order.indexOf(itemId);
  order.splice(sourceIndex + 1, 0, duplicateId);
  await applyOrder(client, serviceId, order);
  const touched = await touchPlannerService(client, service);
  await auditItemMutation(client, service.organizationId, userId, "planner.item.duplicated", serviceId, {
    itemId: duplicateId,
    sourceItemId: itemId,
    itemType: source.item_type,
    title: source.title,
    fromStatus: touched.fromStatus,
    toStatus: touched.toStatus,
    edgeAssignmentsCleared: touched.edgeAssignmentsCleared
  });
  const updatedDetail = await loadPlannerServiceDetail(client, userId, serviceId);
  return {
    item: updatedDetail.items.find((item) => item.id === duplicateId)!,
    items: updatedDetail.items,
    revision: updatedDetail.revision,
    service: updatedDetail.service,
    edgeAssignment: updatedDetail.edgeAssignment
  };
}

export async function reorderPlannerItems(
  client: PoolClient,
  userId: string,
  serviceId: string,
  expectedRevision: string,
  orderedIds: readonly string[]
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  const detail = await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  const currentIds = detail.items.map((item) => item.id);
  const currentSet = new Set(currentIds);
  const submittedSet = new Set(orderedIds);
  const sameSet = orderedIds.length === currentIds.length
    && submittedSet.size === orderedIds.length
    && orderedIds.every((id) => currentSet.has(id));
  if (!sameSet) {
    throw new PlannerServiceError(422, "planner_reorder_set_mismatch", "Reorder list must contain every service item exactly once");
  }

  await applyOrder(client, serviceId, orderedIds);
  const touched = await touchPlannerService(client, service);
  await auditItemMutation(client, service.organizationId, userId, "planner.item.reordered", serviceId, {
    itemCount: orderedIds.length,
    oldOrderHash: hashOrder(currentIds),
    newOrderHash: hashOrder(orderedIds),
    fromStatus: touched.fromStatus,
    toStatus: touched.toStatus,
    edgeAssignmentsCleared: touched.edgeAssignmentsCleared
  });
  const updatedDetail = await loadPlannerServiceDetail(client, userId, serviceId);
  return {
    items: updatedDetail.items,
    revision: updatedDetail.revision,
    service: updatedDetail.service,
    edgeAssignment: updatedDetail.edgeAssignment
  };
}
