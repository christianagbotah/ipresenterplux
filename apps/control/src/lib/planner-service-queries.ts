import type { PoolClient } from "pg";
import { PLANNER_MUTATION_ROLES } from "./role-policy.js";
import { computePlannerRevision } from "./planner-revision-runtime.js";

const SERVICE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SERVICE_FILTERS = new Set(["upcoming", "draft", "ready", "live", "ended", "archived"]);

export class PlannerServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PlannerServiceError";
    this.status = status;
    this.code = code;
  }
}

type PlannerServiceRow = {
  id: string;
  organization_id: string;
  campus_id: string | null;
  campus_name: string | null;
  title: string;
  service_type: string;
  status: string;
  scheduled_start: string | null;
  started_at: string | null;
  ended_at: string | null;
  active_bible_version: string;
  created_at: string;
  updated_at: string;
  timezone: string;
  item_count?: string | number;
  edge_count?: string | number;
};

type PlannerItemRow = {
  id: string;
  item_type: string;
  title: string;
  content: unknown;
  sort_order: number;
  state: string;
  created_at: string;
  updated_at: string;
};

export type PlannerServiceListOptions = {
  filter?: string | null;
  organizationId?: string | null;
  campusId?: string | null;
  limit?: number;
  offset?: number;
};

export type CreatePlannerServiceInput = {
  organizationId: string;
  title: string;
  serviceType?: string | null;
  campusId?: string | null;
  scheduledStart?: string | null;
  activeBibleVersion: string;
};

export type UpdatePlannerServiceInput = {
  title?: string;
  serviceType?: string;
  campusId?: string | null;
  scheduledStart?: string | null;
  activeBibleVersion?: string;
};

function mapService(row: PlannerServiceRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    campusId: row.campus_id,
    campusName: row.campus_name,
    title: row.title,
    serviceType: row.service_type,
    status: row.status,
    scheduledStart: row.scheduled_start,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeBibleVersion: row.active_bible_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    timezone: row.timezone,
    itemCount: Number(row.item_count ?? 0),
    edgeAssignmentCount: Number(row.edge_count ?? 0)
  };
}

function mapItem(row: PlannerItemRow) {
  return {
    id: row.id,
    itemType: row.item_type,
    title: row.title,
    content: row.content,
    sortOrder: row.sort_order,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function membershipRoles(client: PoolClient, userId: string, organizationId: string) {
  const result = await client.query<{ role_id: string }>(
    `select role_id
     from user_organization_roles
     where user_id=$1 and organization_id=$2
     order by role_id`,
    [userId, organizationId]
  );
  return result.rows.map((row) => row.role_id);
}

function canMutate(roles: readonly string[]) {
  return roles.some((role) => PLANNER_MUTATION_ROLES.includes(role));
}

async function requireMutationRole(client: PoolClient, userId: string, organizationId: string) {
  const roles = await membershipRoles(client, userId, organizationId);
  if (!canMutate(roles)) {
    throw new PlannerServiceError(403, "planner_forbidden", "You are not allowed to modify service plans");
  }
  return roles;
}

async function resolveCampus(client: PoolClient, organizationId: string, campusId: string | null | undefined) {
  if (!campusId) return null;
  const result = await client.query<{ id: string }>(
    `select id::text from campuses where id=$1 and organization_id=$2 limit 1`,
    [campusId, organizationId]
  );
  if (!result.rowCount) {
    throw new PlannerServiceError(404, "campus_not_found", "Campus not found");
  }
  return result.rows[0].id;
}

async function resolveBibleVersion(client: PoolClient, version: string) {
  const normalized = version.trim();
  const result = await client.query<{ id: string }>(
    `select id from bible_versions where upper(id)=upper($1) and local_enabled=true limit 1`,
    [normalized]
  );
  if (!result.rowCount) {
    throw new PlannerServiceError(422, "bible_version_unavailable", "Bible version is not available locally");
  }
  return result.rows[0].id;
}

function normalizeTitle(value: string) {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || title.length > 160) {
    throw new PlannerServiceError(422, "invalid_service_title", "Service title must be between 1 and 160 characters");
  }
  return title;
}

function normalizeServiceType(value: string | null | undefined) {
  const serviceType = (value?.trim() || "sunday_service").toLowerCase();
  if (!SERVICE_TYPE_PATTERN.test(serviceType)) {
    throw new PlannerServiceError(422, "invalid_service_type", "Service type is invalid");
  }
  return serviceType;
}

function normalizeScheduledStart(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new PlannerServiceError(422, "invalid_scheduled_start", "Scheduled start is invalid");
  }
  return parsed.toISOString();
}

async function loadItems(client: PoolClient, serviceId: string) {
  const result = await client.query<PlannerItemRow>(
    `select id::text,item_type,title,content,sort_order,state,created_at::text,updated_at::text
     from presentation_items where service_id=$1 order by sort_order,id`,
    [serviceId]
  );
  return result.rows.map(mapItem);
}

function revisionFor(service: ReturnType<typeof mapService>, items: ReturnType<typeof mapItem>[]) {
  return computePlannerRevision({
    serviceId: service.id,
    serviceUpdatedAt: service.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      sortOrder: item.sortOrder,
      state: item.state,
      updatedAt: item.updatedAt
    }))
  });
}

async function loadServiceRow(client: PoolClient, userId: string, serviceId: string, forUpdate = false) {
  const result = await client.query<PlannerServiceRow>(
    `select s.id::text,s.organization_id::text,s.campus_id::text,c.name as campus_name,
            s.title,s.service_type,s.status,s.scheduled_start::text,s.started_at::text,s.ended_at::text,
            s.active_bible_version,s.created_at::text,s.updated_at::text,o.timezone,
            (select count(*) from presentation_items pi where pi.service_id=s.id) as item_count,
            (select count(*) from edge_devices ed where ed.active_service_id=s.id) as edge_count
     from services s
     join organizations o on o.id=s.organization_id
     left join campuses c on c.id=s.campus_id
     where s.id=$1
       and exists (
         select 1 from user_organization_roles uor
         where uor.user_id=$2 and uor.organization_id=s.organization_id
       )
     ${forUpdate ? "for update of s" : ""}
     limit 1`,
    [serviceId, userId]
  );
  if (!result.rowCount) {
    throw new PlannerServiceError(404, "service_not_found", "Service not found");
  }
  return result.rows[0];
}

export async function listPlannerServices(client: PoolClient, userId: string, options: PlannerServiceListOptions = {}) {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 25)));
  const offset = Math.max(0, Math.min(10_000, Math.trunc(options.offset ?? 0)));
  const values: unknown[] = [userId];
  const where = [
    `exists (select 1 from user_organization_roles uor where uor.user_id=$1 and uor.organization_id=s.organization_id)`
  ];

  if (options.organizationId) {
    values.push(options.organizationId);
    where.push(`s.organization_id=$${values.length}`);
  }
  if (options.campusId) {
    values.push(options.campusId);
    where.push(`s.campus_id=$${values.length}`);
  }
  if (options.filter) {
    if (!SERVICE_FILTERS.has(options.filter)) {
      throw new PlannerServiceError(400, "invalid_filter", "Planner service filter is invalid");
    }
    if (options.filter === "upcoming") {
      where.push(`s.status in ('draft','ready') and (s.scheduled_start is null or s.scheduled_start>=now())`);
    } else {
      values.push(options.filter);
      where.push(`s.status=$${values.length}`);
    }
  }
  values.push(limit, offset);
  const limitParam = values.length - 1;
  const offsetParam = values.length;

  const result = await client.query<PlannerServiceRow>(
    `select s.id::text,s.organization_id::text,s.campus_id::text,c.name as campus_name,
            s.title,s.service_type,s.status,s.scheduled_start::text,s.started_at::text,s.ended_at::text,
            s.active_bible_version,s.created_at::text,s.updated_at::text,o.timezone,
            (select count(*) from presentation_items pi where pi.service_id=s.id) as item_count,
            (select count(*) from edge_devices ed where ed.active_service_id=s.id) as edge_count
     from services s
     join organizations o on o.id=s.organization_id
     left join campuses c on c.id=s.campus_id
     where ${where.join(" and ")}
     order by s.scheduled_start nulls last,s.updated_at desc,s.id desc
     limit $${limitParam} offset $${offsetParam}`,
    values
  );

  return { services: result.rows.map(mapService), limit, offset };
}

export async function createPlannerService(client: PoolClient, userId: string, input: CreatePlannerServiceInput) {
  await requireMutationRole(client, userId, input.organizationId);
  const campusId = await resolveCampus(client, input.organizationId, input.campusId);
  const activeBibleVersion = await resolveBibleVersion(client, input.activeBibleVersion);
  const title = normalizeTitle(input.title);
  const serviceType = normalizeServiceType(input.serviceType);
  const scheduledStart = normalizeScheduledStart(input.scheduledStart);

  const result = await client.query<PlannerServiceRow>(
    `insert into services(organization_id,campus_id,title,service_type,status,scheduled_start,active_bible_version,updated_at)
     values ($1,$2,$3,$4,'draft',$5,$6,clock_timestamp())
     returning id::text,organization_id::text,campus_id::text,null::text as campus_name,title,service_type,status,
               scheduled_start::text,started_at::text,ended_at::text,active_bible_version,
               created_at::text,updated_at::text,''::text as timezone,0::int as item_count,0::int as edge_count`,
    [input.organizationId, campusId, title, serviceType, scheduledStart, activeBibleVersion]
  );
  const service = mapService(result.rows[0]);
  const organization = await client.query<{ timezone: string }>("select timezone from organizations where id=$1", [input.organizationId]);
  service.timezone = organization.rows[0]?.timezone ?? "UTC";

  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'planner.service.created','service',$3,$4::jsonb)`,
    [input.organizationId, userId, service.id, JSON.stringify({ title, serviceType, campusId, scheduledStart, activeBibleVersion, status: "draft" })]
  );

  return { service, revision: revisionFor(service, []) };
}

export async function loadPlannerServiceDetail(client: PoolClient, userId: string, serviceId: string) {
  const row = await loadServiceRow(client, userId, serviceId);
  const service = mapService(row);
  const items = await loadItems(client, serviceId);
  const roles = await membershipRoles(client, userId, service.organizationId);
  const revision = revisionFor(service, items);
  return {
    service,
    items,
    readiness: { status: "not_validated", issues: [] as { code: string; label: string; itemId?: string }[] },
    revision,
    canEdit: canMutate(roles) && (service.status === "draft" || service.status === "ready"),
    edgeAssignment: { count: service.edgeAssignmentCount }
  };
}

export async function updatePlannerServiceMetadata(
  client: PoolClient,
  userId: string,
  serviceId: string,
  expectedRevision: string,
  input: UpdatePlannerServiceInput
) {
  const locked = await loadServiceRow(client, userId, serviceId, true);
  const current = mapService(locked);
  await requireMutationRole(client, userId, current.organizationId);
  if (current.status !== "draft" && current.status !== "ready") {
    throw new PlannerServiceError(409, "service_not_editable", "Service is not editable in its current state");
  }

  const items = await loadItems(client, serviceId);
  const currentRevision = revisionFor(current, items);
  if (expectedRevision !== currentRevision) {
    throw new PlannerServiceError(409, "planner_revision_conflict", "Service plan changed; refresh before saving");
  }

  const nextTitle = input.title === undefined ? current.title : normalizeTitle(input.title);
  const nextServiceType = input.serviceType === undefined ? current.serviceType : normalizeServiceType(input.serviceType);
  const nextCampusId = input.campusId === undefined ? current.campusId : await resolveCampus(client, current.organizationId, input.campusId);
  const nextScheduledStart = input.scheduledStart === undefined ? current.scheduledStart : normalizeScheduledStart(input.scheduledStart);
  const nextBibleVersion = input.activeBibleVersion === undefined
    ? current.activeBibleVersion
    : await resolveBibleVersion(client, input.activeBibleVersion);
  const nextStatus = current.status === "ready" ? "draft" : current.status;

  const changedFields = [
    ["title", current.title, nextTitle],
    ["serviceType", current.serviceType, nextServiceType],
    ["campusId", current.campusId, nextCampusId],
    ["scheduledStart", current.scheduledStart, nextScheduledStart],
    ["activeBibleVersion", current.activeBibleVersion, nextBibleVersion]
  ].filter(([, before, after]) => before !== after).map(([name]) => name);

  const result = await client.query<PlannerServiceRow>(
    `update services
     set title=$2,service_type=$3,campus_id=$4,scheduled_start=$5,active_bible_version=$6,status=$7,updated_at=clock_timestamp()
     where id=$1
     returning id::text,organization_id::text,campus_id::text,null::text as campus_name,title,service_type,status,
               scheduled_start::text,started_at::text,ended_at::text,active_bible_version,
               created_at::text,updated_at::text,''::text as timezone,
               (select count(*) from presentation_items pi where pi.service_id=services.id) as item_count,
               (select count(*) from edge_devices ed where ed.active_service_id=services.id) as edge_count`,
    [serviceId, nextTitle, nextServiceType, nextCampusId, nextScheduledStart, nextBibleVersion, nextStatus]
  );

  let edgeAssignmentsCleared = 0;
  if (current.status === "ready") {
    const cleared = await client.query(
      `update edge_devices set active_service_id=null,updated_at=clock_timestamp() where active_service_id=$1 and organization_id=$2`,
      [serviceId, current.organizationId]
    );
    edgeAssignmentsCleared = cleared.rowCount ?? 0;
  }

  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'planner.service.updated','service',$3,$4::jsonb)`,
    [current.organizationId, userId, serviceId, JSON.stringify({
      title: nextTitle,
      fromStatus: current.status,
      toStatus: nextStatus,
      changedFields,
      edgeAssignmentsCleared
    })]
  );

  const updated = mapService(result.rows[0]);
  const organization = await client.query<{ timezone: string }>("select timezone from organizations where id=$1", [current.organizationId]);
  updated.timezone = organization.rows[0]?.timezone ?? "UTC";
  updated.edgeAssignmentCount = current.status === "ready" ? 0 : updated.edgeAssignmentCount;
  return { service: updated, revision: revisionFor(updated, items), edgeAssignment: { count: updated.edgeAssignmentCount } };
}
