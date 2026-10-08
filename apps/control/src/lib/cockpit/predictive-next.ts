import type { PoolClient } from "pg";
import type { CockpitNextItem } from "./contracts.ts";
import { listCockpitRecommendations, listServicePins } from "./recommendations.ts";

const SOURCE_FRESHNESS_MS = 120_000;
const MAX_ITEMS = 12;

type PlannedRow = { id:string; item_type:string; title:string; state:string; sort_order:number; updated_at:string };
type CameraTruthRow = { id:string; source_seen_at:string; edge_seen_at:string };

function fresh(value:string, now:Date) {
  const time=new Date(value).getTime();
  return Number.isFinite(time) && time <= now.getTime()+5_000 && now.getTime()-time <= SOURCE_FRESHNESS_MS;
}
function targetKey(targetType:string,targetId:string){return `${targetType}:${targetId}`;}

export async function projectPredictiveNext(
  client: PoolClient,
  input:{organizationId:string;serviceId:string;now?:Date}
):Promise<CockpitNextItem[]> {
  const now=input.now ? new Date(input.now) : new Date();
  const plannedResult=await client.query<PlannedRow>(`select id::text,item_type,title,state,sort_order,updated_at::text from presentation_items where service_id=$1 and state='queued' order by sort_order,id limit 20`,[input.serviceId]);
  const cameraTruth=await client.query<CameraTruthRow>(`select ms.id::text,ms.last_seen_at::text as source_seen_at,ed.last_seen_at::text as edge_seen_at from media_sources ms join edge_devices ed on ed.id=ms.edge_device_id and ed.organization_id=ms.organization_id where ms.organization_id=$1 and ms.source_type in ('camera','video_input','video_capture') and ms.status in ('ready','live') and ed.status='active' and (ed.active_service_id=$2 or ed.active_service_id is null)`,[input.organizationId,input.serviceId]);
  const validCameraIds=new Set(cameraTruth.rows.filter((row)=>fresh(row.source_seen_at,now)&&fresh(row.edge_seen_at,now)).map((row)=>row.id));
  const recommendations=await listCockpitRecommendations(client,{organizationId:input.organizationId,serviceId:input.serviceId,now});
  const pins=await listServicePins(client,{organizationId:input.organizationId,serviceId:input.serviceId});
  const pinnedTargets=new Set(pins.map((pin)=>targetKey(pin.targetType,pin.targetId)));

  const pinned:CockpitNextItem[]=pins.map((pin)=>({id:pin.id,source:"pinned",targetType:pin.targetType,targetId:pin.targetId,title:pin.title,state:"pinned",sortOrder:null,confidence:null,reason:"Pinned by an operator",observedAt:pin.updatedAt,freshUntil:null,actions:pin.targetType==="scripture_detection"?["preview","open","pin","use_instead"]:["open","pin","use_instead"]}));
  const recommended:CockpitNextItem[]=recommendations
    .filter((item)=>item.state==="suggested"||item.state==="prepared")
    .filter((item)=>Boolean(item.targetId))
    .filter((item)=>item.targetType!=="camera_source"||validCameraIds.has(item.targetId!))
    .filter((item)=>!pinnedTargets.has(targetKey(item.targetType,item.targetId!)))
    .map((item)=>({id:item.id,source:"recommendation" as const,targetType:item.targetType,targetId:item.targetId!,title:typeof item.payload.reference==="string"?item.payload.reference:item.reason.replace(/ is available from the active Edge$/,""),state:item.state,sortOrder:null,confidence:item.confidence,reason:item.reason,observedAt:item.sourceObservedAt,freshUntil:item.expiresAt,actions:item.targetType==="scripture_detection"&&item.state!=="prepared"?["preview","open","pin","dismiss","use_instead"]:["open","pin","dismiss","use_instead"]}));
  const planned:CockpitNextItem[]=plannedResult.rows.filter((row)=>!pinnedTargets.has(targetKey("presentation_item",row.id))).map((row)=>({id:row.id,source:"planned" as const,targetType:row.item_type,targetId:row.id,title:row.title,state:row.state,sortOrder:row.sort_order,confidence:null,reason:"Planned service rundown",observedAt:row.updated_at,freshUntil:null,actions:["open","pin","use_instead"]}));

  return [...pinned,...recommended,...planned].sort((left,right)=>{
    const sourceRank=(item:CockpitNextItem)=>item.source==="pinned"?0:item.source==="recommendation"?1:2;
    const rank=sourceRank(left)-sourceRank(right); if(rank) return rank;
    if(left.source==="recommendation"&&right.source==="recommendation"){const prepared=(left.state==="prepared"?0:1)-(right.state==="prepared"?0:1);if(prepared)return prepared;const confidence=(right.confidence??0)-(left.confidence??0);if(confidence)return confidence;}
    if(left.source==="planned"&&right.source==="planned"){const order=(left.sortOrder??Number.MAX_SAFE_INTEGER)-(right.sortOrder??Number.MAX_SAFE_INTEGER);if(order)return order;}
    return `${left.targetType}:${left.targetId}:${left.id}`.localeCompare(`${right.targetType}:${right.targetId}:${right.id}`);
  }).slice(0,MAX_ITEMS);
}
