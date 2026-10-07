import type { PoolClient } from "pg";
import { PLANNER_ITEM_TYPES, PLANNER_MAX_ITEMS } from "./planner-contracts.ts";
import { normalizePlannerItem } from "./planner-item-normalize.ts";
import { PlannerItemError } from "./planner-item-schemas.ts";
import {
  assertPlannerRevision,
  lockEditablePlannerService,
  touchPlannerService
} from "./planner-mutations.ts";
import {
  PlannerServiceError,
  loadPlannerServiceDetail
} from "./planner-service-queries.ts";

export type PlannerReadinessIssue = {
  code: string;
  label: string;
  itemId?: string;
};

export type PlannerReadinessResult = {
  ready: boolean;
  issues: PlannerReadinessIssue[];
};

export class PlannerReadinessError extends PlannerServiceError {
  issues: PlannerReadinessIssue[];

  constructor(issues: PlannerReadinessIssue[]) {
    super(422, "readiness_failed", "Service readiness checks failed");
    this.name = "PlannerReadinessError";
    this.issues = issues;
  }
}

type StoredItem = {
  id: string;
  item_type: string;
  title: string;
  content: Record<string, unknown>;
  sort_order: number;
  state: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function addIssue(issues: PlannerReadinessIssue[], code: string, label: string, itemId?: string) {
  if (issues.length >= 200) return;
  issues.push({ code, label: label.slice(0, 240), ...(itemId ? { itemId } : {}) });
}

function storedInput(item: StoredItem) {
  const content = asObject(item.content);
  switch (item.item_type) {
    case "scripture":
      return {
        reference: content.reference,
        version: content.version,
        footer: content.footer
      };
    case "song":
      return {
        title: item.title,
        author: content.author ?? undefined,
        sections: content.sections,
        defaultSection: content.defaultSection ?? undefined
      };
    case "slide":
    case "custom":
      return {
        title: item.title,
        body: content.body,
        footer: content.footer ?? undefined,
        style: content.style ?? undefined
      };
    case "announcement":
      return {
        title: item.title,
        body: content.body,
        footer: content.footer ?? undefined,
        dateNote: content.dateNote ?? undefined,
        style: content.style ?? undefined
      };
    case "lower_third":
      return {
        primaryText: content.primaryText ?? item.title,
        secondaryText: content.secondaryText ?? content.footer ?? undefined,
        durationSeconds: content.durationSeconds ?? undefined
      };
    case "media":
      return {
        title: item.title,
        sourceId: content.sourceId,
        mediaKind: content.mediaKind,
        operatorNotes: content.operatorNotes ?? undefined
      };
    case "camera":
      return {
        sourceId: content.sourceId,
        label: content.label ?? item.title,
        operatorNote: content.operatorNote ?? undefined
      };
    default:
      return content;
  }
}

export async function validatePlannerReadiness(
  client: PoolClient,
  serviceId: string,
  organizationId: string
): Promise<PlannerReadinessResult> {
  const issues: PlannerReadinessIssue[] = [];
  const serviceResult = await client.query<{
    id: string;
    organization_id: string;
    campus_id: string | null;
    scheduled_start: string | null;
    active_bible_version: string;
  }>(
    `select id::text,organization_id::text,campus_id::text,scheduled_start::text,active_bible_version
     from services where id=$1 and organization_id=$2 limit 1`,
    [serviceId, organizationId]
  );
  if (!serviceResult.rowCount) {
    throw new PlannerServiceError(404, "service_not_found", "Service not found");
  }
  const service = serviceResult.rows[0];

  if (!service.scheduled_start) {
    addIssue(issues, "scheduled_start_required", "Schedule a start time before marking this service ready.");
  }

  const version = await client.query<{ id: string }>(
    `select id from bible_versions where upper(id)=upper($1) and local_enabled=true limit 1`,
    [service.active_bible_version]
  );
  if (!version.rowCount) {
    addIssue(issues, "bible_version_unavailable", "Choose a locally enabled Bible version.");
  }

  if (service.campus_id) {
    const campus = await client.query<{ id: string }>(
      `select id::text from campuses where id=$1 and organization_id=$2 limit 1`,
      [service.campus_id, organizationId]
    );
    if (!campus.rowCount) {
      addIssue(issues, "service_campus_scope_invalid", "The selected campus does not belong to this organization.");
    }
  }

  const itemResult = await client.query<StoredItem>(
    `select id::text,item_type,title,content,sort_order,state
     from presentation_items
     where service_id=$1
     order by sort_order,id
     limit $2`,
    [serviceId, PLANNER_MAX_ITEMS + 1]
  );
  const items = itemResult.rows;
  if (!items.length) {
    addIssue(issues, "rundown_empty", "Add at least one rundown cue before marking the service ready.");
  }
  if (items.length > PLANNER_MAX_ITEMS) {
    addIssue(issues, "rundown_item_limit", `Rundown exceeds the ${PLANNER_MAX_ITEMS}-item limit.`);
  }

  const logicalOrders = new Set<number>();
  for (const item of items.slice(0, PLANNER_MAX_ITEMS)) {
    if (logicalOrders.has(item.sort_order)) {
      addIssue(issues, "item_order_invalid", "Rundown contains duplicate item order values.", item.id);
    }
    logicalOrders.add(item.sort_order);

    if (item.state !== "queued") {
      addIssue(issues, "item_state_invalid", "Reset this cue to queued before marking the service ready.", item.id);
      continue;
    }
    if (!(PLANNER_ITEM_TYPES as readonly string[]).includes(item.item_type)) {
      addIssue(issues, "item_type_invalid", "This cue type is not supported by the Service Planner.", item.id);
      continue;
    }

    try {
      await normalizePlannerItem(
        client,
        organizationId,
        item.item_type,
        storedInput(item),
        { defaultBibleVersion: service.active_bible_version }
      );
    } catch (error) {
      if (item.item_type === "scripture") {
        addIssue(issues, "scripture_unresolved", "Resolve this Scripture passage again before marking the service ready.", item.id);
      } else if (item.item_type === "media" && error instanceof PlannerItemError && error.code === "media_source_unsafe") {
        addIssue(issues, "media_source_unsafe", "This media cue no longer points to an approved safe source.", item.id);
      } else {
        addIssue(issues, "item_invalid", "This cue contains incomplete or invalid presentation data.", item.id);
      }
    }
  }

  return { ready: issues.length === 0, issues };
}

export async function markPlannerServiceReady(
  client: PoolClient,
  userId: string,
  serviceId: string,
  expectedRevision: string
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  const readiness = await validatePlannerReadiness(client, serviceId, service.organizationId);
  if (!readiness.ready) throw new PlannerReadinessError(readiness.issues);

  await client.query(
    `update services
     set status='ready',started_at=null,ended_at=null,updated_at=clock_timestamp()
     where id=$1`,
    [serviceId]
  );
  const assigned = await client.query(
    `update edge_devices
     set active_service_id=$1,updated_at=clock_timestamp()
     where organization_id=$2
       and campus_id is not distinct from $3::uuid
       and status='active'
       and active_service_id is null`,
    [serviceId, service.organizationId, service.campusId]
  );
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'planner.service.ready','service',$3,$4::jsonb)`,
    [service.organizationId, userId, serviceId, JSON.stringify({
      fromStatus: service.status,
      toStatus: "ready",
      edgeDevicesAssigned: assigned.rowCount ?? 0
    })]
  );
  return loadPlannerServiceDetail(client, userId, serviceId);
}

export async function returnPlannerServiceToDraft(
  client: PoolClient,
  userId: string,
  serviceId: string,
  expectedRevision: string
) {
  const service = await lockEditablePlannerService(client, userId, serviceId);
  await assertPlannerRevision(client, userId, serviceId, expectedRevision);
  const touched = await touchPlannerService(client, service);
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'planner.service.draft','service',$3,$4::jsonb)`,
    [service.organizationId, userId, serviceId, JSON.stringify({
      fromStatus: touched.fromStatus,
      toStatus: touched.toStatus,
      edgeAssignmentsCleared: touched.edgeAssignmentsCleared
    })]
  );
  return loadPlannerServiceDetail(client, userId, serviceId);
}
