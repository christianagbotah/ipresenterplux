import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { PLANNER_MUTATION_ROLES } from "../role-policy.js";
import type { ServiceMemoryChapter, ServiceMemoryRecord } from "./contracts.ts";
import { ServiceIntelligenceError } from "./notes.ts";

const GENERATOR_VERSION = "deterministic-v1";
const MAX_TRANSCRIPT_SEGMENTS = 5000;
const MAX_CHAPTERS = 24;
const CHAPTER_GAP_MS = 4 * 60 * 1000;
const CHAPTER_SUMMARY_MAX = 1200;

type ServiceRow={id:string;organization_id:string;title:string;service_type:string;status:string;started_at:string|null;ended_at:string|null;roles:string[]};
type ItemRow={id:string;item_type:string;title:string;state:string;sort_order:number;updated_at:string;content_text:string};
type ScriptureRow={id:string;scripture_reference:string;confidence:string|number;state:string;detection_method:string;source_observed_at:string};
type TranscriptRow={id:string;text:string;source_observed_at:string;created_at:string;source_language:string|null;speaker_id:string|null;speaker_source:string;asr_confidence:number|null};
type StreamRow={id:string;status:string;error_code:string|null;started_at:string|null;ended_at:string|null;created_at:string;updated_at:string};
type DestinationRow={stream_session_id:string;name:string;destination_type:string;status:string;last_error_code:string|null;provider_health_state:string;provider_live_state:string;provider_error_code:string|null;provider_issue_codes:string[];updated_at:string};
type ArtifactRow={artifact_type:string;status:string;storage_kind:string;metadata:Record<string,unknown>;updated_at:string};
type LanguageRow={id:string;language_code:string;language_name:string;channel_mode:string;enabled:boolean;audience_sessions:number;last_seen_at:string|null};
type TranslationRow={status:string;count:string|number;last_updated:string|null};
type MemoryRow={service_id:string;organization_id:string;status:"pending"|"ready"|"failed";source_fingerprint:string|null;summary:string;key_scriptures:unknown[];speakers:unknown[];songs_media:unknown[];incidents:unknown[];languages_outputs:Record<string,unknown>;generator_version:string;generated_at:string|null;last_error:string|null;created_at:string;updated_at:string};
type ChapterRow={id:string;organization_id:string;service_id:string;ordinal:number;title:string;summary:string;started_at:string|null;ended_at:string|null;source_kind:"transcript"|"scripture"|"rundown"|"mixed";confidence:string|number;metadata:Record<string,unknown>;created_at:string;updated_at:string};

function bounded(value:string,max:number){const text=value.trim().replace(/\s+/g," ");return text.length<=max?text:`${text.slice(0,max-1)}…`;}
function fingerprint(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function mapMemory(row:MemoryRow):ServiceMemoryRecord{return{serviceId:row.service_id,organizationId:row.organization_id,status:row.status,sourceFingerprint:row.source_fingerprint,summary:row.summary,keyScriptures:Array.isArray(row.key_scriptures)?row.key_scriptures:[],speakers:Array.isArray(row.speakers)?row.speakers:[],songsMedia:Array.isArray(row.songs_media)?row.songs_media:[],incidents:Array.isArray(row.incidents)?row.incidents:[],languagesOutputs:row.languages_outputs??{},generatorVersion:row.generator_version,generatedAt:row.generated_at,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at};}
function mapChapter(row:ChapterRow):ServiceMemoryChapter{return{id:row.id,organizationId:row.organization_id,serviceId:row.service_id,ordinal:Number(row.ordinal),title:row.title,summary:row.summary,startedAt:row.started_at,endedAt:row.ended_at,sourceKind:row.source_kind,confidence:Number(row.confidence),metadata:row.metadata??{},createdAt:row.created_at,updatedAt:row.updated_at};}

async function loadScope(client:PoolClient,userId:string,serviceId:string){
  const result=await client.query<ServiceRow>(`select s.id::text,s.organization_id::text,s.title,s.service_type,s.status,s.started_at::text,s.ended_at::text,array_agg(uor.role_id order by uor.role_id) as roles from services s join user_organization_roles uor on uor.organization_id=s.organization_id and uor.user_id=$2 where s.id=$1 group by s.id limit 1`,[serviceId,userId]);
  if(!result.rowCount) throw new ServiceIntelligenceError(404,"service_not_found","Service not found");
  const row=result.rows[0];
  if(!(row.roles??[]).some(role=>PLANNER_MUTATION_ROLES.includes(role))) throw new ServiceIntelligenceError(403,"service_memory_forbidden","You are not allowed to rebuild service memory");
  if(!["ended","archived"].includes(row.status)) throw new ServiceIntelligenceError(409,"service_memory_not_ended","Service memory can only be built after a service ends");
  return row;
}

const MEMORY_SELECT=`select service_id::text,organization_id::text,status,source_fingerprint,summary,key_scriptures,speakers,songs_media,incidents,languages_outputs,generator_version,generated_at::text,last_error,created_at::text,updated_at::text from service_memories`;
const CHAPTER_SELECT=`select id::text,organization_id::text,service_id::text,ordinal,title,summary,started_at::text,ended_at::text,source_kind,confidence,metadata,created_at::text,updated_at::text from service_memory_chapters`;
async function loadStored(client:PoolClient,serviceId:string){
  const memory=await client.query<MemoryRow>(`${MEMORY_SELECT} where service_id=$1`,[serviceId]);
  const chapters=await client.query<ChapterRow>(`${CHAPTER_SELECT} where service_id=$1 order by ordinal,id`,[serviceId]);
  return{memory:memory.rows[0]?mapMemory(memory.rows[0]):null,chapters:chapters.rows.map(mapChapter)};
}

function deriveChapters(service:ServiceRow,transcripts:TranscriptRow[],scriptures:ScriptureRow[],items:ItemRow[]){
  type Draft={speaker:string|null;start:string;end:string;parts:string[]};
  const drafts:Draft[]=[];
  for(const segment of transcripts){
    const time=new Date(segment.source_observed_at);
    const last=drafts.at(-1);
    const lastTime=last?new Date(last.end):null;
    const speakerChanged=Boolean(last&&last.speaker!==segment.speaker_id);
    const gap=Boolean(lastTime&&time.getTime()-lastTime.getTime()>CHAPTER_GAP_MS);
    if(!last||((speakerChanged||gap)&&drafts.length<MAX_CHAPTERS)){
      drafts.push({speaker:segment.speaker_id,start:segment.source_observed_at,end:segment.source_observed_at,parts:[segment.text]});
    }else{
      last.end=segment.source_observed_at;
      if(last.parts.join(" ").length<CHAPTER_SUMMARY_MAX*2) last.parts.push(segment.text);
    }
  }
  if(!drafts.length){
    const itemNames=items.slice(0,6).map(x=>x.title);
    const refs=[...new Set(scriptures.map(x=>x.scripture_reference))].slice(0,6);
    const details=[itemNames.length?`Rundown: ${itemNames.join(", ")}`:"",refs.length?`Scriptures: ${refs.join(", ")}`:""].filter(Boolean).join(". ")||"No transcript was captured for this service.";
    return[{ordinal:0,title:"Service overview",summary:bounded(details,CHAPTER_SUMMARY_MAX),startedAt:service.started_at,endedAt:service.ended_at,sourceKind:(scriptures.length||items.length)?"mixed" as const:"rundown" as const,confidence:100,metadata:{speakerId:null,scriptures:refs}}];
  }
  return drafts.map((draft,index)=>{
    const inside=scriptures.filter(s=>{const t=new Date(s.source_observed_at).getTime();return t>=new Date(draft.start).getTime()&&t<=new Date(draft.end).getTime();}).map(s=>s.scripture_reference);
    const refs=[...new Set(inside)].slice(0,5);
    const speaker=draft.speaker?`Speaker ${draft.speaker}`:`Service segment ${index+1}`;
    return{ordinal:index,title:refs[0]?`${refs[0]} · ${speaker}`:speaker,summary:bounded(draft.parts.join(" "),CHAPTER_SUMMARY_MAX),startedAt:draft.start,endedAt:draft.end,sourceKind:refs.length?"mixed" as const:"transcript" as const,confidence:100,metadata:{speakerId:draft.speaker,scriptures:refs}};
  });
}

export async function buildServiceMemory(client:PoolClient,userId:string,serviceId:string,options:{now?:Date}={}){
  const now=options.now?new Date(options.now):new Date();
  const service=await loadScope(client,userId,serviceId);
  const org=service.organization_id;
  const items=(await client.query<ItemRow>(`select id::text,item_type,title,state,sort_order,updated_at::text,left(content::text,2000) as content_text from presentation_items where service_id=$1 order by sort_order,id`,[serviceId])).rows;
  const scriptures=(await client.query<ScriptureRow>(`select id::text,scripture_reference,confidence,state,detection_method,source_observed_at::text from scripture_detections where service_id=$1 and state<>'dismissed' order by source_observed_at,id limit 500`,[serviceId])).rows;
  const transcriptMeta=(await client.query<{count:string|number;last_created:string|null;last_observed:string|null}>(`select count(*)::int as count,max(created_at)::text as last_created,max(source_observed_at)::text as last_observed from transcript_segments where service_id=$1`,[serviceId])).rows[0];
  const transcripts=(await client.query<TranscriptRow>(`select id::text,left(text,2000) as text,source_observed_at::text,created_at::text,source_language,speaker_id,speaker_source,asr_confidence from transcript_segments where service_id=$1 order by source_observed_at,created_at,id limit $2`,[serviceId,MAX_TRANSCRIPT_SEGMENTS])).rows;
  const streams=(await client.query<StreamRow>(`select id::text,status,error_code,started_at::text,ended_at::text,created_at::text,updated_at::text from stream_sessions where service_id=$1 order by created_at,id`,[serviceId])).rows;
  const destinations=(await client.query<DestinationRow>(`select ssd.stream_session_id::text,od.name,od.destination_type,ssd.status,ssd.last_error_code,ssd.provider_health_state,ssd.provider_live_state,ssd.provider_error_code,ssd.provider_issue_codes,ssd.updated_at::text from stream_session_destinations ssd join stream_sessions ss on ss.id=ssd.stream_session_id join output_destinations od on od.id=ssd.output_destination_id where ss.service_id=$1 order by ss.created_at,od.name,ssd.id`,[serviceId])).rows;
  const artifacts=(await client.query<ArtifactRow>(`select artifact_type,status,storage_kind,metadata,updated_at::text from service_artifacts where service_id=$1 and organization_id=$2 order by created_at,id`,[serviceId,org])).rows;
  const languages=(await client.query<LanguageRow>(`select lc.id::text,lc.language_code,lc.language_name,lc.channel_mode,lc.enabled,
      count(distinct aus.id)::int as audience_sessions,max(aus.last_seen_at)::text as last_seen_at
    from language_channels lc
    left join audience_sessions aus on aus.language_channel_id=lc.id and aus.service_id=$2::uuid
    where lc.organization_id=$1::uuid
    group by lc.id,lc.language_code,lc.language_name,lc.channel_mode,lc.enabled
    order by lc.language_code,lc.channel_mode,lc.id`,[org,serviceId])).rows;
  const translations=(await client.query<TranslationRow>(`select ttj.status,count(*)::int as count,max(ttj.updated_at)::text as last_updated from transcript_translation_jobs ttj join transcript_segments ts on ts.id=ttj.transcript_segment_id where ts.service_id=$1 group by ttj.status order by ttj.status`,[serviceId])).rows;
  const source={service:{id:service.id,title:service.title,type:service.service_type,status:service.status,startedAt:service.started_at,endedAt:service.ended_at},items,scriptures,transcriptMeta,transcripts,streams,destinations,artifacts,languages,translations};
  const sourceFingerprint=fingerprint(source);
  const existing=await loadStored(client,serviceId);
  if(existing.memory?.status==="ready"&&existing.memory.sourceFingerprint===sourceFingerprint) return{...existing,regenerated:false};
  const scriptureUnique=[...new Map(scriptures.map(s=>[s.scripture_reference,{reference:s.scripture_reference,confidence:Number(s.confidence),observedAt:s.source_observed_at,method:s.detection_method}])).values()].slice(0,20);
  const speakerMap=new Map<string,{id:string;source:string;segments:number}>();
  for(const t of transcripts){if(!t.speaker_id)continue;const prior=speakerMap.get(t.speaker_id)??{id:t.speaker_id,source:t.speaker_source,segments:0};prior.segments++;speakerMap.set(t.speaker_id,prior);}
  const speakers=[...speakerMap.values()].sort((a,b)=>b.segments-a.segments||a.id.localeCompare(b.id)).slice(0,30);
  const songsMedia=items.filter(x=>["song","media"].includes(x.item_type)).map(x=>({type:x.item_type,title:x.title,state:x.state})).slice(0,50);
  const incidents:Array<Record<string,unknown>>=[];
  for(const s of streams){if(s.status==="error"||s.error_code)incidents.push({kind:"stream",code:s.error_code??"stream_error",status:s.status,observedAt:s.ended_at??s.updated_at});}
  for(const d of destinations){const codes=[d.last_error_code,d.provider_error_code,...(d.provider_issue_codes??[])].filter(Boolean);if(d.status==="warning"||d.status==="error"||d.provider_health_state==="warning"||d.provider_health_state==="error"||codes.length)incidents.push({kind:"destination",name:d.name,code:codes[0]??d.status,status:d.status,providerHealth:d.provider_health_state,observedAt:d.updated_at});}
  const translationCounts=Object.fromEntries(translations.map(r=>[r.status,Number(r.count)]));
  const translationTotal=Object.values(translationCounts).reduce((a,b)=>a+b,0);
  const operations={
    audience:{
      uniqueSessions:languages.reduce((sum,l)=>sum+l.audience_sessions,0),
      lastSeenAt:languages.map(l=>l.last_seen_at).filter(Boolean).sort().at(-1)??null
    },
    languages:languages.filter(l=>l.enabled).map(l=>({code:l.language_code,name:l.language_name,mode:l.channel_mode,audienceSessions:l.audience_sessions,lastSeenAt:l.last_seen_at})),
    translations:{total:translationTotal,succeeded:translationCounts.succeeded??0,failed:translationCounts.failed??0,pending:translationCounts.pending??0,processing:translationCounts.processing??0},
    outputs:destinations.map(d=>({name:d.name,type:d.destination_type,status:d.status,providerHealth:d.provider_health_state})),
    artifacts:{count:artifacts.length,items:artifacts.map(a=>({type:a.artifact_type,status:a.status,storageKind:a.storage_kind,metadata:a.metadata})).slice(0,30)}
  };
  const chapters=deriveChapters(service,transcripts,scriptures,items);
  const parts=[`${service.title} ended with ${items.length} rundown item${items.length===1?"":"s"}`,`${scriptureUnique.length} Scripture reference${scriptureUnique.length===1?"":"s"}`,`${speakers.length} identified speaker${speakers.length===1?"":"s"}`,`${translationCounts.succeeded??0}/${translationTotal} translation jobs completed`,`${incidents.length} stream/output incident${incidents.length===1?"":"s"}`,`${artifacts.length} artifact${artifacts.length===1?"":"s"}`];
  if(scriptureUnique.length)parts.push(`Key Scriptures: ${scriptureUnique.slice(0,5).map(x=>x.reference).join(", ")}`);
  if(songsMedia.length)parts.push(`Songs/media: ${songsMedia.slice(0,5).map(x=>x.title).join(", ")}`);
  const summary=bounded(parts.join(". ")+".",20000);
  await client.query(`insert into service_memories(service_id,organization_id,status,source_fingerprint,summary,key_scriptures,speakers,songs_media,incidents,languages_outputs,generator_version,generated_at,last_error,updated_at) values($1,$2,'ready',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,null,$11) on conflict(service_id) do update set organization_id=excluded.organization_id,status='ready',source_fingerprint=excluded.source_fingerprint,summary=excluded.summary,key_scriptures=excluded.key_scriptures,speakers=excluded.speakers,songs_media=excluded.songs_media,incidents=excluded.incidents,languages_outputs=excluded.languages_outputs,generator_version=excluded.generator_version,generated_at=excluded.generated_at,last_error=null,updated_at=excluded.updated_at`,[serviceId,org,sourceFingerprint,summary,JSON.stringify(scriptureUnique),JSON.stringify(speakers),JSON.stringify(songsMedia),JSON.stringify(incidents),JSON.stringify(operations),GENERATOR_VERSION,now]);
  await client.query(`delete from service_memory_chapters where service_id=$1 and organization_id=$2`,[serviceId,org]);
  for(const chapter of chapters){
    await client.query(`insert into service_memory_chapters(organization_id,service_id,ordinal,title,summary,started_at,ended_at,source_kind,confidence,metadata,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,[org,serviceId,chapter.ordinal,chapter.title,chapter.summary,chapter.startedAt,chapter.endedAt,chapter.sourceKind,chapter.confidence,JSON.stringify(chapter.metadata),now]);
  }
  await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details) values($1,'operator',$2,'service.memory.generated','service',$3,$4::jsonb)`,[org,userId,serviceId,JSON.stringify({sourceFingerprint,generatorVersion:GENERATOR_VERSION,chapterCount:chapters.length})]);
  const stored=await loadStored(client,serviceId);
  return{memory:stored.memory!,chapters:stored.chapters,regenerated:true};
}

async function recordFailure(client:PoolClient,userId:string,serviceId:string,error:unknown,now:Date){
  const result=await client.query<{organization_id:string}>(`select s.organization_id::text from services s where s.id=$1 and exists(select 1 from user_organization_roles uor where uor.user_id=$2 and uor.organization_id=s.organization_id)`,[serviceId,userId]);
  if(!result.rowCount)return;
  const org=result.rows[0].organization_id;
  const message=bounded(error instanceof Error?error.message:String(error),1800);
  await client.query(`insert into service_memories(service_id,organization_id,status,generator_version,last_error,updated_at) values($1,$2,'failed',$3,$4,$5) on conflict(service_id) do update set status='failed',generator_version=excluded.generator_version,last_error=excluded.last_error,updated_at=excluded.updated_at`,[serviceId,org,GENERATOR_VERSION,message,now]);
  await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details) values($1,'operator',$2,'service.memory.generation_failed','service',$3,$4::jsonb)`,[org,userId,serviceId,JSON.stringify({error:message,generatorVersion:GENERATOR_VERSION})]);
}

export async function buildEndedServiceMemoryBestEffort(serviceId:string,userId:string){
  const {db}=await import("../db.ts");
  const client=await db.connect();
  try{
    await client.query("begin");
    const result=await buildServiceMemory(client,userId,serviceId);
    await client.query("commit");
    return{status:"ready" as const,regenerated:result.regenerated};
  }catch(error){
    await client.query("rollback").catch(()=>{});
    try{await client.query("begin");await recordFailure(client,userId,serviceId,error,new Date());await client.query("commit");}catch{await client.query("rollback").catch(()=>{});}
    return{status:"failed" as const,regenerated:false};
  }finally{client.release();}
}
