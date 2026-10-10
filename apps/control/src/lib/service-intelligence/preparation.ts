import type { PoolClient } from "pg";
import { listMediaLibrary } from "../media-library.ts";
import { createPlannerItem } from "../planner-mutations.ts";
import { loadPlannerServiceDetail } from "../planner-service-queries.ts";
import { detectScriptureReferences } from "../scripture.ts";
import type { ServicePreparationContext, ServicePreparationSuggestion } from "./contracts.ts";
import { listServicePreparationNotes, ServiceIntelligenceError } from "./notes.ts";

const EDGE_FRESHNESS_MS = 120_000;
const HISTORY_LIMIT = 5;
const LIBRARY_LIMIT = 50;

type PreviousServiceRow = { id:string; title:string; ended_at:string|null; updated_at:string; summary:string|null };
type PreviousItemRow = { service_id:string; item_type:string; title:string; content:unknown };
type OutputRow = { enabled:string|number; healthy:string|number; degraded:string|number };
type LanguageRow = { enabled:string|number; listeners:string|number };
type EdgeRow = { id:string; name:string; last_seen_at:string|null };

function asDate(value:string|null|undefined){ if(!value) return null; const d=new Date(value); return Number.isFinite(d.getTime())?d:null; }
function ageDays(observed:string|null,now:Date){ const d=asDate(observed); return d?Math.max(0,(now.getTime()-d.getTime())/86400000):9999; }
function key(type:string,title:string){ return `${type}:${title.trim().toLowerCase().replace(/\s+/g," ")}`; }
function short(value:string,max=700){ const normalized=value.trim().replace(/\s+/g," "); return normalized.length<=max?normalized:`${normalized.slice(0,max-1)}…`; }
function rank(kind:ServicePreparationSuggestion["kind"]){ return ({scripture_reference:10,history_reuse:20,readiness_attention:30,history_context:40,library_reuse:50} as const)[kind]; }
function sorted(items:ServicePreparationSuggestion[]){ return items.sort((a,b)=>rank(a.kind)-rank(b.kind) || b.confidence-a.confidence || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)); }

export async function buildServicePreparationContext(
  client:PoolClient,
  userId:string,
  serviceId:string,
  options:{now?:Date}={}
):Promise<ServicePreparationContext>{
  const now=options.now?new Date(options.now):new Date();
  const detail=await loadPlannerServiceDetail(client,userId,serviceId);
  const service=detail.service;
  const organizationId=service.organizationId;
  const notes=await listServicePreparationNotes(client,userId,serviceId);
  const library=(await listMediaLibrary(client,userId,{organizationId,limit:LIBRARY_LIMIT,offset:0})).items;

  const previous=await client.query<PreviousServiceRow>(
    `select s.id::text,s.title,s.ended_at::text,s.updated_at::text,sm.summary
       from services s left join service_memories sm on sm.service_id=s.id and sm.organization_id=s.organization_id and sm.status='ready'
      where s.organization_id=$1 and s.id<>$2 and s.service_type=$3 and s.status in ('ended','archived')
      order by coalesce(s.ended_at,s.updated_at) desc,s.id desc limit $4`,
    [organizationId,serviceId,service.serviceType,HISTORY_LIMIT]
  );
  const previousIds=previous.rows.map(row=>row.id);
  const previousItems=previousIds.length ? await client.query<PreviousItemRow>(
    `select service_id::text,item_type,title,content from presentation_items
      where service_id=any($1::uuid[]) and item_type in ('song','slide','media')
      order by service_id,sort_order,id`,[previousIds]
  ) : {rows:[] as PreviousItemRow[]};

  const output=await client.query<OutputRow>(
    `select count(*) filter(where enabled)::int as enabled,
            count(*) filter(where enabled and status in ('ready','live'))::int as healthy,
            count(*) filter(where enabled and status not in ('ready','live'))::int as degraded
       from output_destinations where organization_id=$1`,[organizationId]
  );
  const language=await client.query<LanguageRow>(
    `select count(*) filter(where enabled)::int as enabled,coalesce(sum(listener_count) filter(where enabled),0)::int as listeners
       from language_channels where organization_id=$1`,[organizationId]
  );
  const edges=await client.query<EdgeRow>(
    `select id::text,name,last_seen_at::text from edge_devices
      where organization_id=$1 and status='active' and ($2::uuid is null or campus_id is not distinct from $2::uuid or campus_id is null)
      order by case when campus_id is not distinct from $2::uuid then 0 else 1 end,last_seen_at desc nulls last,id`,[organizationId,service.campusId]
  );
  const edge=edges.rows[0]??null;
  const edgeSeen=asDate(edge?.last_seen_at);
  const edgeFreshness:ServicePreparationContext["readiness"]["edge"]["freshness"] = !edgeSeen ? "unavailable" : now.getTime()-edgeSeen.getTime()<=EDGE_FRESHNESS_MS ? "current" : "stale";

  const suggestions:ServicePreparationSuggestion[]=[];
  const scriptureSeen=new Set<string>();
  for(const note of notes){
    for(const match of detectScriptureReferences(note.content)){
      const refKey=match.reference.toLowerCase(); if(scriptureSeen.has(refKey)) continue; scriptureSeen.add(refKey);
      suggestions.push({
        id:`note-scripture:${note.id}:${refKey}`,kind:"scripture_reference",title:`Scripture · ${match.reference}`,
        reason:`Referenced in ${note.title}`,evidence:short(match.matchedSourceText??match.reference,320),confidence:match.confidence,
        sourceServiceId:serviceId,sourceObservedAt:note.updatedAt,
        plannerCandidate:{itemType:"scripture",input:{reference:match.reference,version:service.activeBibleVersion}},navigationTarget:"/scripture"
      });
    }
  }

  const currentKeys=new Set(detail.items.map(item=>key(item.itemType,item.title)));
  const libraryByKey=new Map(library.map(item=>[key(item.itemType,item.title),item]));
  const previousById=new Map(previous.rows.map(row=>[row.id,row]));
  const reuseSeen=new Set<string>();
  for(const item of previousItems.rows){
    const itemKey=key(item.item_type,item.title); if(currentKeys.has(itemKey)||reuseSeen.has(itemKey)) continue;
    const reusable=libraryByKey.get(itemKey); if(!reusable || reusable.previewEligibility!=="eligible") continue;
    const source=previousById.get(item.service_id); if(!source) continue; reuseSeen.add(itemKey);
    const observed=source.ended_at??source.updated_at;
    const confidence=Math.max(65,Math.round(90-Math.min(25,ageDays(observed,now)*0.5)));
    suggestions.push({id:`history-reuse:${item.service_id}:${itemKey}`,kind:"history_reuse",title:item.title,
      reason:`Used in ${source.title} and available in your reusable library`,evidence:`Previous ${item.item_type}: ${item.title}`,
      confidence,sourceServiceId:item.service_id,sourceObservedAt:observed,
      plannerCandidate:{itemType:reusable.itemType,input:reusable.plannerInput},navigationTarget:`/archive/${item.service_id}`});
  }

  for(const source of previous.rows){
    if(!source.summary?.trim()) continue;
    const observed=source.ended_at??source.updated_at;
    suggestions.push({id:`history-context:${source.id}`,kind:"history_context",title:`Previous service · ${source.title}`,
      reason:"Recent service memory from the same service type",evidence:short(source.summary,700),
      confidence:Math.max(45,Math.round(70-Math.min(20,ageDays(observed,now)*0.4))),sourceServiceId:source.id,sourceObservedAt:observed,
      plannerCandidate:null,navigationTarget:`/archive/${source.id}`});
  }

  for(const item of library){
    const itemKey=key(item.itemType,item.title); if(currentKeys.has(itemKey)||reuseSeen.has(itemKey)||item.previewEligibility!=="eligible") continue;
    suggestions.push({id:`library:${item.id}`,kind:"library_reuse",title:item.title,reason:"Reusable item already available in this church library",
      evidence:`${item.itemType} · updated ${item.updatedAt}`,confidence:55,sourceServiceId:null,sourceObservedAt:item.updatedAt,
      plannerCandidate:{itemType:item.itemType,input:item.plannerInput},navigationTarget:"/media"});
  }

  const outputs=output.rows[0]??{enabled:0,healthy:0,degraded:0};
  const languages=language.rows[0]??{enabled:0,listeners:0};
  if(Number(outputs.degraded)>0) suggestions.push({id:"readiness:outputs",kind:"readiness_attention",title:"Check broadcast outputs",
    reason:"One or more enabled outputs are not ready",evidence:`${Number(outputs.degraded)} degraded of ${Number(outputs.enabled)} enabled`,confidence:100,
    sourceServiceId:serviceId,sourceObservedAt:null,plannerCandidate:null,navigationTarget:"/streaming"});
  if(edgeFreshness!=="current") suggestions.push({id:"readiness:edge",kind:"readiness_attention",title:"Check church Edge",
    reason:edgeFreshness==="stale"?"The latest Edge heartbeat is stale":"No active Edge heartbeat is available",evidence:edge?.last_seen_at??"No heartbeat",
    confidence:100,sourceServiceId:serviceId,sourceObservedAt:edge?.last_seen_at??null,plannerCandidate:null,navigationTarget:"/settings/devices"});

  return {
    organizationId,
    service:{id:service.id,title:service.title,serviceType:service.serviceType,status:service.status,campusId:service.campusId,activeBibleVersion:service.activeBibleVersion,scheduledStart:service.scheduledStart},
    notes,
    readiness:{outputs:{enabled:Number(outputs.enabled),healthy:Number(outputs.healthy),degraded:Number(outputs.degraded)},languages:{enabled:Number(languages.enabled),listeners:Number(languages.listeners)},edge:{count:edges.rowCount??edges.rows.length,name:edge?.name??null,freshness:edgeFreshness,lastSeenAt:edge?.last_seen_at??null}},
    suggestions:sorted(suggestions)
  };
}


export async function applyServicePreparationSuggestion(
  client: PoolClient,
  userId: string,
  input: { serviceId: string; suggestionId: string; expectedRevision: string; now?: Date }
) {
  const context = await buildServicePreparationContext(client, userId, input.serviceId, { now: input.now });
  const suggestion = context.suggestions.find((item) => item.id === input.suggestionId);
  if (!suggestion) {
    throw new ServiceIntelligenceError(404, "service_preparation_suggestion_not_found", "Preparation suggestion was not found");
  }
  if (!suggestion.plannerCandidate) {
    throw new ServiceIntelligenceError(409, "service_preparation_navigation_only", "This suggestion is context only and cannot be added to the service plan");
  }
  return createPlannerItem(client, userId, input.serviceId, input.expectedRevision, {
    itemType: suggestion.plannerCandidate.itemType,
    input: suggestion.plannerCandidate.input
  });
}
