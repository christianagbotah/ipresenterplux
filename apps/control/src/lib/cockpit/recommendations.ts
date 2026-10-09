import type { PoolClient } from "pg";
import { LIVE_OPERATOR_ROLES } from "../role-policy.js";

export type CockpitRecommendationState = "suggested" | "prepared" | "accepted" | "dismissed" | "expired";

export class CockpitRecommendationError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.name = "CockpitRecommendationError"; this.status = status; this.code = code;
  }
}

type RecommendationRow = {
  id:string; organization_id:string; service_id:string; source_key:string; recommendation_type:string;
  target_type:string; target_id:string|null; payload:Record<string,unknown>; confidence:string|number; reason:string; evidence:string;
  source_observed_at:string; expires_at:string; state:CockpitRecommendationState; preview_result_type:string|null; preview_result_id:string|null;
  created_at:string; updated_at:string;
};
type PinRow = { id:string; organization_id:string; service_id:string; target_type:string; target_id:string; title:string; payload:Record<string,unknown>; created_by:string|null; created_at:string; updated_at:string };

export type CockpitRecommendation = ReturnType<typeof mapRecommendation>;
export type CockpitServicePin = ReturnType<typeof mapPin>;

function mapRecommendation(row: RecommendationRow) {
  return { id:row.id, organizationId:row.organization_id, serviceId:row.service_id, sourceKey:row.source_key,
    recommendationType:row.recommendation_type, targetType:row.target_type, targetId:row.target_id, payload:row.payload ?? {},
    confidence:Number(row.confidence), reason:row.reason, evidence:row.evidence, sourceObservedAt:row.source_observed_at,
    expiresAt:row.expires_at, state:row.state, previewResultType:row.preview_result_type, previewResultId:row.preview_result_id,
    createdAt:row.created_at, updatedAt:row.updated_at };
}
function mapPin(row: PinRow) {
  return { id:row.id, organizationId:row.organization_id, serviceId:row.service_id, targetType:row.target_type, targetId:row.target_id,
    title:row.title, payload:row.payload ?? {}, createdBy:row.created_by, createdAt:row.created_at, updatedAt:row.updated_at };
}
const REC_SELECT=`select id::text,organization_id::text,service_id::text,source_key,recommendation_type,target_type,target_id,payload,
  confidence,reason,evidence,source_observed_at::text,expires_at::text,state,preview_result_type,preview_result_id,created_at::text,updated_at::text
  from cockpit_recommendations`;
const PIN_SELECT=`select id::text,organization_id::text,service_id::text,target_type,target_id,title,payload,created_by::text,created_at::text,updated_at::text
  from cockpit_service_pins`;

async function requireOperator(client: PoolClient, actorUserId: string, organizationId: string) {
  const result=await client.query<{role_id:string}>(`select role_id from user_organization_roles where user_id=$1 and organization_id=$2 and role_id=any($3::text[])`,[actorUserId,organizationId,LIVE_OPERATOR_ROLES]);
  if(!result.rowCount) throw new CockpitRecommendationError(403,"cockpit_operator_forbidden","Live operator permission is required");
}

export async function listCockpitRecommendations(client: PoolClient, input:{organizationId:string;serviceId:string;now?:Date}) {
  const now=input.now ?? new Date();
  const result=await client.query<RecommendationRow>(`${REC_SELECT} where organization_id=$1 and service_id=$2 order by case state when 'prepared' then 0 when 'suggested' then 1 when 'accepted' then 2 when 'dismissed' then 3 else 4 end,confidence desc,source_observed_at desc,id desc`,[input.organizationId,input.serviceId]);
  return result.rows.map((row) => {
    const recommendation=mapRecommendation(row);
    if ((recommendation.state === "suggested" || recommendation.state === "prepared") && new Date(recommendation.expiresAt).getTime() <= now.getTime()) {
      return { ...recommendation, state: "expired" as const };
    }
    return recommendation;
  });
}

export async function upsertCockpitRecommendation(client: PoolClient, input:{organizationId:string;serviceId:string;sourceKey:string;recommendationType:string;targetType:string;targetId?:string|null;payload?:Record<string,unknown>;confidence:number;reason:string;evidence?:string;sourceObservedAt:Date;expiresAt:Date;state?:CockpitRecommendationState;previewResultType?:string|null;previewResultId?:string|null;now?:Date}) {
  const now=input.now ?? new Date();
  const result=await client.query<RecommendationRow>(`insert into cockpit_recommendations
    (organization_id,service_id,source_key,recommendation_type,target_type,target_id,payload,confidence,reason,evidence,source_observed_at,expires_at,state,preview_result_type,preview_result_id,updated_at)
    values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    on conflict (service_id,source_key) do update set
      recommendation_type=excluded.recommendation_type,target_type=excluded.target_type,target_id=excluded.target_id,payload=excluded.payload,
      confidence=excluded.confidence,reason=excluded.reason,evidence=excluded.evidence,source_observed_at=excluded.source_observed_at,
      expires_at=excluded.expires_at,state=case when cockpit_recommendations.state in ('dismissed','accepted') then cockpit_recommendations.state else excluded.state end,
      preview_result_type=coalesce(excluded.preview_result_type,cockpit_recommendations.preview_result_type),preview_result_id=coalesce(excluded.preview_result_id,cockpit_recommendations.preview_result_id),updated_at=excluded.updated_at
    returning id::text,organization_id::text,service_id::text,source_key,recommendation_type,target_type,target_id,payload,confidence,reason,evidence,source_observed_at::text,expires_at::text,state,preview_result_type,preview_result_id,created_at::text,updated_at::text`,
    [input.organizationId,input.serviceId,input.sourceKey.trim(),input.recommendationType.trim(),input.targetType.trim(),input.targetId ?? null,JSON.stringify(input.payload ?? {}),input.confidence,input.reason.trim(),input.evidence ?? "",input.sourceObservedAt,input.expiresAt,input.state ?? "suggested",input.previewResultType ?? null,input.previewResultId ?? null,now]);
  return mapRecommendation(result.rows[0]);
}

export async function setCockpitRecommendationState(client: PoolClient, actorUserId:string, input:{recommendationId:string;state:CockpitRecommendationState;previewResultType?:string|null;previewResultId?:string|null;now?:Date}) {
  const found=await client.query<RecommendationRow>(`${REC_SELECT} where id=$1 and exists(select 1 from user_organization_roles uor where uor.user_id=$2 and uor.organization_id=cockpit_recommendations.organization_id) limit 1`,[input.recommendationId,actorUserId]);
  if(!found.rowCount) throw new CockpitRecommendationError(404,"cockpit_recommendation_not_found","Cockpit recommendation was not found");
  const current=found.rows[0]; await requireOperator(client,actorUserId,current.organization_id);
  const now=input.now ?? new Date();
  const result=await client.query<RecommendationRow>(`update cockpit_recommendations set state=$2,preview_result_type=coalesce($3,preview_result_type),preview_result_id=coalesce($4,preview_result_id),updated_at=$5 where id=$1 returning id::text,organization_id::text,service_id::text,source_key,recommendation_type,target_type,target_id,payload,confidence,reason,evidence,source_observed_at::text,expires_at::text,state,preview_result_type,preview_result_id,created_at::text,updated_at::text`,[input.recommendationId,input.state,input.previewResultType ?? null,input.previewResultId ?? null,now]);
  if(current.state !== input.state) await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details) values ($1,'operator',$2,'cockpit.recommendation.state.updated','cockpit_recommendation',$3,$4::jsonb)`,[current.organization_id,actorUserId,input.recommendationId,JSON.stringify({from:current.state,to:input.state})]);
  return mapRecommendation(result.rows[0]);
}

export async function listServicePins(client: PoolClient,input:{organizationId:string;serviceId:string}) {
  const result=await client.query<PinRow>(`${PIN_SELECT} where organization_id=$1 and service_id=$2 order by updated_at desc,id desc`,[input.organizationId,input.serviceId]);
  return result.rows.map(mapPin);
}

export async function setServicePin(client: PoolClient,actorUserId:string,input:{organizationId:string;serviceId:string;targetType:string;targetId:string;title:string;payload?:Record<string,unknown>;pinned:boolean;now?:Date}) {
  await requireOperator(client,actorUserId,input.organizationId);
  const service=await client.query(`select 1 from services where id=$1 and organization_id=$2`,[input.serviceId,input.organizationId]);
  if(!service.rowCount) throw new CockpitRecommendationError(404,"cockpit_service_not_found","Service was not found");
  const now=input.now ?? new Date();
  if(!input.pinned){
    const removed=await client.query<PinRow>(`${PIN_SELECT} where organization_id=$1 and service_id=$2 and target_type=$3 and target_id=$4`,[input.organizationId,input.serviceId,input.targetType,input.targetId]);
    await client.query(`delete from cockpit_service_pins where organization_id=$1 and service_id=$2 and target_type=$3 and target_id=$4`,[input.organizationId,input.serviceId,input.targetType,input.targetId]);
    if(removed.rowCount) await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details) values ($1,'operator',$2,'cockpit.pin.updated','service',$3,$4::jsonb)`,[input.organizationId,actorUserId,input.serviceId,JSON.stringify({pinned:false,targetType:input.targetType,targetId:input.targetId})]);
    return null;
  }
  const result=await client.query<PinRow>(`insert into cockpit_service_pins(organization_id,service_id,target_type,target_id,title,payload,created_by,updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) on conflict(service_id,target_type,target_id) do update set title=excluded.title,payload=excluded.payload,updated_at=excluded.updated_at returning id::text,organization_id::text,service_id::text,target_type,target_id,title,payload,created_by::text,created_at::text,updated_at::text`,[input.organizationId,input.serviceId,input.targetType.trim(),input.targetId.trim(),input.title.trim(),JSON.stringify(input.payload ?? {}),actorUserId,now]);
  await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details) values ($1,'operator',$2,'cockpit.pin.updated','service',$3,$4::jsonb)`,[input.organizationId,actorUserId,input.serviceId,JSON.stringify({pinned:true,targetType:input.targetType,targetId:input.targetId})]);
  return mapPin(result.rows[0]);
}
