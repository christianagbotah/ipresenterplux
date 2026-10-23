import type { PoolClient } from "pg";
import { requireEntitlementFeature, EntitlementAccessError } from "./licensing/entitlement-access.ts";
import { createPlannerItem } from "./planner-mutations.ts";
import { loadPlannerServiceDetail, PlannerServiceError } from "./planner-service-queries.ts";
import { PLANNER_MUTATION_ROLES } from "./role-policy.js";
import type { ServiceMemoryChapter, ServiceMemoryRecord } from "./service-intelligence/contracts.ts";

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
  memory_status?: "pending" | "ready" | "failed" | null;
  memory_summary?: string | null;
  memory_generated_at?: string | null;
  memory_chapter_count?: string | number | null;
};

type ArchivedItemRow = {
  id: string;
  item_type: string;
  title: string;
  content: Record<string, unknown>;
  sort_order: number;
  state: string;
};

type ServiceMemoryRow = {
  service_id: string; organization_id: string; status: "pending"|"ready"|"failed"; source_fingerprint: string|null; summary: string;
  key_scriptures: unknown[]; speakers: unknown[]; songs_media: unknown[]; incidents: unknown[]; languages_outputs: Record<string,unknown>;
  generator_version: string; generated_at: string|null; last_error: string|null; created_at: string; updated_at: string;
};

type ServiceMemoryChapterRow = {
  id:string;organization_id:string;service_id:string;ordinal:number;title:string;summary:string;started_at:string|null;ended_at:string|null;
  source_kind:"transcript"|"scripture"|"rundown"|"mixed";confidence:string|number;metadata:Record<string,unknown>;created_at:string;updated_at:string;
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

function escapeLike(value: string) {
  return value.replace(/[\%_]/g, (character) => `\\${character}`);
}

function memoryPublic(row: ServiceMemoryRow | undefined): ServiceMemoryRecord | null {
  if (!row) return null;
  return {
    serviceId:row.service_id,organizationId:row.organization_id,status:row.status,sourceFingerprint:row.source_fingerprint,summary:row.summary,
    keyScriptures:Array.isArray(row.key_scriptures)?row.key_scriptures:[],speakers:Array.isArray(row.speakers)?row.speakers:[],
    songsMedia:Array.isArray(row.songs_media)?row.songs_media:[],incidents:Array.isArray(row.incidents)?row.incidents:[],
    languagesOutputs:row.languages_outputs??{},generatorVersion:row.generator_version,generatedAt:row.generated_at,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at
  };
}

function chapterPublic(row: ServiceMemoryChapterRow): ServiceMemoryChapter {
  return {id:row.id,organizationId:row.organization_id,serviceId:row.service_id,ordinal:Number(row.ordinal),title:row.title,summary:row.summary,startedAt:row.started_at,endedAt:row.ended_at,sourceKind:row.source_kind,confidence:Number(row.confidence),metadata:row.metadata??{},createdAt:row.created_at,updatedAt:row.updated_at};
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
  let relevance = "0";
  if (search) {
    const normalized = escapeLike(search);
    values.push(`%${normalized}%`);
    const pattern = `$${values.length}`;
    values.push(`${normalized}%`);
    const prefix = `$${values.length}`;
    where.push(`(
      s.title ilike ${pattern} escape '\\'
      or sm.summary ilike ${pattern} escape '\\'
      or sm.speakers::text ilike ${pattern} escape '\\'
      or exists (select 1 from service_memory_chapters smc where smc.service_id=s.id and (smc.title ilike ${pattern} escape '\\' or smc.summary ilike ${pattern} escape '\\'))
      or exists (select 1 from scripture_detections sd where sd.service_id=s.id and (sd.scripture_reference ilike ${pattern} escape '\\' or sd.source_text ilike ${pattern} escape '\\'))
      or exists (select 1 from transcript_segments ts where ts.service_id=s.id and ts.text ilike ${pattern} escape '\\')
    )`);
    relevance = `case when s.title ilike ${prefix} escape '\\' then 80 when s.title ilike ${pattern} escape '\\' then 60 when exists (select 1 from scripture_detections sd where sd.service_id=s.id and sd.scripture_reference ilike ${pattern} escape '\\') then 50 when sm.summary ilike ${pattern} escape '\\' then 40 else 20 end`;
  }
  values.push(limitValue(filters.limit));
  const limitIndex = values.length;
  values.push(offsetValue(filters.offset));
  const offsetIndex = values.length;

  const result = await client.query<ArchiveServiceRow>(
    `select s.id::text,s.organization_id::text,o.name as organization_name,c.name as campus_name,
            s.title,s.service_type,s.scheduled_start::text,s.started_at::text,s.ended_at::text,
            sm.status as memory_status,sm.summary as memory_summary,sm.generated_at::text as memory_generated_at,
            (select count(*) from service_memory_chapters smc where smc.service_id=s.id) as memory_chapter_count
       from services s
       join organizations o on o.id=s.organization_id
       left join campuses c on c.id=s.campus_id and c.organization_id=s.organization_id
       left join service_memories sm on sm.service_id=s.id and sm.organization_id=s.organization_id
      where ${where.join(" and ")}
      order by ${relevance} desc,s.ended_at desc nulls last,s.id desc
      limit $${limitIndex} offset $${offsetIndex}`,
    values
  );
  return {
    services: result.rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, organizationName: row.organization_name, campusName: row.campus_name,
      title: row.title, serviceType: row.service_type, scheduledStart: row.scheduled_start, startedAt: row.started_at, endedAt: row.ended_at,
      memoryStatus: row.memory_status ?? null, memorySummary: row.memory_summary ?? null, memoryGeneratedAt: row.memory_generated_at ?? null,
      memoryChapterCount: Number(row.memory_chapter_count ?? 0)
    })),
    limit: limitValue(filters.limit), offset: offsetValue(filters.offset)
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
  const rundown = await client.query<{ id:string; item_type:string; title:string; content:Record<string,unknown>; sort_order:number; state:string }>(
    `select id::text,item_type,title,content,sort_order,state
       from presentation_items where service_id=$1::uuid
      order by sort_order,id`, [serviceId]);
  const scripture = await client.query<{ id:string; scripture_reference:string; confidence:string; state:string; detection_method:string; source_text:string; source_observed_at:string }>(
    `select id::text,scripture_reference,confidence::text,state,detection_method,source_text,source_observed_at::text
       from scripture_detections where service_id=$1::uuid
      order by source_observed_at,source_ordinal,detected_at,id`, [serviceId]);
  const transcript = await client.query<{ count:string; first_observed_at:string|null; last_observed_at:string|null; preview:string|null }>(
    `select count(*)::text as count,min(source_observed_at)::text as first_observed_at,
            max(source_observed_at)::text as last_observed_at,
            (array_agg(left(text,240) order by source_observed_at desc,id desc))[1] as preview
       from transcript_segments where service_id=$1::uuid`, [serviceId]);
  const memory = await client.query<ServiceMemoryRow>(
    `select service_id::text,organization_id::text,status,source_fingerprint,summary,key_scriptures,speakers,songs_media,incidents,languages_outputs,generator_version,generated_at::text,last_error,created_at::text,updated_at::text
       from service_memories where service_id=$1::uuid and organization_id=$2::uuid limit 1`,[serviceId,service.organization_id]);
  const memoryChapters = await client.query<ServiceMemoryChapterRow>(
    `select id::text,organization_id::text,service_id::text,ordinal,title,summary,started_at::text,ended_at::text,source_kind,confidence,metadata,created_at::text,updated_at::text
       from service_memory_chapters where service_id=$1::uuid and organization_id=$2::uuid order by ordinal,id`,[serviceId,service.organization_id]);
  const artifacts = await client.query<ArtifactRow>(
    `select id::text,organization_id::text,service_id::text,artifact_type,status,storage_kind,storage_locator,
            metadata,created_at::text,updated_at::text
       from service_artifacts where organization_id=$1::uuid and service_id=$2::uuid
      order by created_at desc,id desc`, [service.organization_id, serviceId]);

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
    memory: memoryPublic(memory.rows[0]),
    memoryChapters: memoryChapters.rows.map(chapterPublic),
    artifacts: artifacts.rows.map(artifactPublic)
  };
}

export async function listArchiveReuseTargets(client: QueryClient, userId: string, sourceServiceId: string) {
  const source = await archivedServiceRow(client,userId,sourceServiceId);
  const roleRows=await client.query<{role_id:string}>(`select role_id from user_organization_roles where user_id=$1 and organization_id=$2 order by role_id`,[userId,source.organization_id]);
  if(!roleRows.rows.some(row=>PLANNER_MUTATION_ROLES.includes(row.role_id))) return [];
  const result=await client.query<{id:string;title:string;status:string;scheduled_start:string|null}>(`select id::text,title,status,scheduled_start::text from services where organization_id=$1::uuid and status in ('draft','ready') and id<>$2::uuid order by scheduled_start nulls last,updated_at desc,id desc limit 50`,[source.organization_id,sourceServiceId]);
  return result.rows.map(row=>({id:row.id,title:row.title,status:row.status,scheduledStart:row.scheduled_start}));
}

function archivedPlannerInput(item: ArchivedItemRow): {itemType:string;input:unknown} {
  const content=item.content&&typeof item.content==="object"&&!Array.isArray(item.content)?item.content:{};
  if(item.item_type==="scripture") return {itemType:"scripture",input:{reference:String(content.reference??item.title),version:typeof content.version==="string"?content.version:undefined,footer:typeof content.footer==="string"?content.footer:undefined}};
  if(item.item_type==="song") {
    const sections=Array.isArray(content.sections)?content.sections.filter((entry):entry is {label:string;text:string}=>Boolean(entry&&typeof entry==="object"&&typeof (entry as {label?:unknown}).label==="string"&&typeof (entry as {text?:unknown}).text==="string")).map(entry=>({label:entry.label,text:entry.text})):[];
    if(!sections.length) throw new ArchiveError(422,"archive_reuse_item_unsupported",`Song “${item.title}” has no reusable sections`);
    return {itemType:"song",input:{title:item.title,author:typeof content.author==="string"?content.author:undefined,sections,defaultSection:typeof content.defaultSection==="number"?content.defaultSection:undefined}};
  }
  if(item.item_type==="slide"||item.item_type==="custom") return {itemType:item.item_type,input:{title:item.title,body:typeof content.body==="string"?content.body:"",footer:typeof content.footer==="string"?content.footer:undefined,style:typeof content.style==="string"?content.style:undefined}};
  if(item.item_type==="announcement") return {itemType:"announcement",input:{title:item.title,body:typeof content.body==="string"?content.body:"",footer:typeof content.footer==="string"?content.footer:undefined,dateNote:typeof content.dateNote==="string"?content.dateNote:undefined,style:content.style==="announcement"?"announcement":undefined}};
  if(item.item_type==="lower_third") return {itemType:"lower_third",input:{primaryText:typeof content.primaryText==="string"?content.primaryText:item.title,secondaryText:typeof content.secondaryText==="string"?content.secondaryText:undefined,durationSeconds:typeof content.durationSeconds==="number"?content.durationSeconds:undefined}};
  if(item.item_type==="media") return {itemType:"media",input:{title:item.title,sourceId:String(content.sourceId??""),mediaKind:content.mediaKind,operatorNotes:typeof content.operatorNotes==="string"?content.operatorNotes:undefined}};
  if(item.item_type==="camera") return {itemType:"camera",input:{sourceId:String(content.sourceId??""),label:typeof content.label==="string"?content.label:item.title,operatorNote:typeof content.operatorNote==="string"?content.operatorNote:undefined}};
  throw new ArchiveError(422,"archive_reuse_item_unsupported",`Archived item type “${item.item_type}” cannot be reused`);
}

export async function reuseArchivedItemsInServicePlan(client: PoolClient, userId: string, input: {sourceServiceId:string;targetServiceId:string;sourceItemIds:string[];expectedRevision:string}) {
  if(!input.sourceItemIds.length||input.sourceItemIds.length>20) throw new ArchiveError(400,"archive_reuse_items_invalid","Choose between 1 and 20 archived items to reuse");
  const source=await archivedServiceRow(client,userId,input.sourceServiceId);
  let target;
  try{target=await loadPlannerServiceDetail(client,userId,input.targetServiceId);}catch(error){if(error instanceof PlannerServiceError) throw error; throw error;}
  if(target.service.organizationId!==source.organization_id) throw new ArchiveError(404,"archive_reuse_target_not_found","Target service was not found in this church");
  if(!target.canEdit) throw new ArchiveError(409,"archive_reuse_target_not_editable","Target service is not editable");
  const ids=[...new Set(input.sourceItemIds)];
  const selected=await client.query<ArchivedItemRow>(`select id::text,item_type,title,content,sort_order,state from presentation_items where service_id=$1::uuid and id=any($2::uuid[]) and state<>'dismissed' order by sort_order,id`,[source.id,ids]);
  if(selected.rows.length!==ids.length) throw new ArchiveError(404,"archive_reuse_item_not_found","One or more archived items were not found");
  let revision=input.expectedRevision;
  const items=[];
  for(const sourceItem of selected.rows){
    const candidate=archivedPlannerInput(sourceItem);
    const created=await createPlannerItem(client,userId,input.targetServiceId,revision,candidate);
    revision=created.revision;
    items.push(created.item);
  }
  await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details) values($1,'operator',$2,'archive.items.reused','service',$3,$4::jsonb)`,[source.organization_id,userId,input.targetServiceId,JSON.stringify({sourceServiceId:source.id,targetServiceId:input.targetServiceId,sourceItemIds:ids,createdItemIds:items.map(item=>item.id)})]);
  return {items,revision,targetServiceId:input.targetServiceId,sourceServiceId:source.id};
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
