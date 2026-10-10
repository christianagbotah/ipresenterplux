import type { PoolClient } from "pg";
import { PLANNER_MUTATION_ROLES } from "../role-policy.js";
import type { ServicePreparationNote, ServicePreparationNoteType } from "./contracts.ts";

type QueryClient = Pick<PoolClient,"query">;

type ServiceScope = { organization_id:string; roles:string[] };
type NoteRow = {
  id:string; organization_id:string; service_id:string; note_type:ServicePreparationNoteType; title:string; content:string;
  source_label:string|null; created_by:string|null; updated_by:string|null; created_at:string; updated_at:string;
};

export class ServiceIntelligenceError extends Error {
  status:number;
  code:string;
  constructor(status:number,code:string,message:string){ super(message); this.name="ServiceIntelligenceError"; this.status=status; this.code=code; }
}

function mapNote(row:NoteRow):ServicePreparationNote {
  return { id:row.id, organizationId:row.organization_id, serviceId:row.service_id, noteType:row.note_type, title:row.title,
    content:row.content, sourceLabel:row.source_label, createdBy:row.created_by, updatedBy:row.updated_by,
    createdAt:row.created_at, updatedAt:row.updated_at };
}

async function serviceScope(client:QueryClient,userId:string,serviceId:string):Promise<ServiceScope> {
  const result=await client.query<ServiceScope>(
    `select s.organization_id::text,array_agg(uor.role_id order by uor.role_id) as roles
       from services s join user_organization_roles uor on uor.organization_id=s.organization_id and uor.user_id=$2
      where s.id=$1 group by s.organization_id limit 1`,[serviceId,userId]);
  if(!result.rowCount) throw new ServiceIntelligenceError(404,"service_not_found","Service not found");
  return result.rows[0];
}

function requireMutation(scope:ServiceScope) {
  if(!(scope.roles ?? []).some(role=>PLANNER_MUTATION_ROLES.includes(role))) {
    throw new ServiceIntelligenceError(403,"service_preparation_forbidden","You are not allowed to modify service preparation notes");
  }
}

function normalized(input:{noteType:ServicePreparationNoteType;title:string;content:string;sourceLabel?:string|null}) {
  const allowed=new Set<ServicePreparationNoteType>(["sermon_notes","service_notes","operator_notes"]);
  if(!allowed.has(input.noteType)) throw new ServiceIntelligenceError(422,"service_note_type_invalid","Preparation note type is invalid");
  const title=input.title.trim().replace(/\s+/g," ");
  if(!title || title.length>160) throw new ServiceIntelligenceError(422,"service_note_title_invalid","Preparation note title must be between 1 and 160 characters");
  const content=input.content.replace(/\r\n?/g,"\n").trim();
  if(!content) throw new ServiceIntelligenceError(422,"service_note_empty","Preparation note content is required");
  if(content.length>100000) throw new ServiceIntelligenceError(422,"service_note_too_large","Preparation note content cannot exceed 100000 characters");
  const sourceLabel=input.sourceLabel?.trim() || null;
  if(sourceLabel && sourceLabel.length>240) throw new ServiceIntelligenceError(422,"service_note_source_too_large","Preparation note source label is too long");
  return {noteType:input.noteType,title,content,sourceLabel};
}

const SELECT=`select id::text,organization_id::text,service_id::text,note_type,title,content,source_label,
  created_by::text,updated_by::text,created_at::text,updated_at::text from service_preparation_notes`;

export async function listServicePreparationNotes(client:QueryClient,userId:string,serviceId:string):Promise<ServicePreparationNote[]> {
  const scope=await serviceScope(client,userId,serviceId);
  const result=await client.query<NoteRow>(`${SELECT} where organization_id=$1 and service_id=$2 order by updated_at desc,id desc`,[scope.organization_id,serviceId]);
  return result.rows.map(mapNote);
}

export async function upsertServicePreparationNote(client:QueryClient,userId:string,input:{
  serviceId:string; noteId?:string; noteType:ServicePreparationNoteType; title:string; content:string; sourceLabel?:string|null;
}):Promise<ServicePreparationNote> {
  const scope=await serviceScope(client,userId,input.serviceId); requireMutation(scope); const value=normalized(input);
  let result;
  let action;
  if(input.noteId){
    result=await client.query<NoteRow>(`update service_preparation_notes set note_type=$4,title=$5,content=$6,source_label=$7,updated_by=$8,updated_at=clock_timestamp()
      where id=$1 and organization_id=$2 and service_id=$3
      returning id::text,organization_id::text,service_id::text,note_type,title,content,source_label,created_by::text,updated_by::text,created_at::text,updated_at::text`,
      [input.noteId,scope.organization_id,input.serviceId,value.noteType,value.title,value.content,value.sourceLabel,userId]);
    if(!result.rowCount) throw new ServiceIntelligenceError(404,"service_note_not_found","Preparation note not found");
    action="service.preparation_note.updated";
  } else {
    result=await client.query<NoteRow>(`insert into service_preparation_notes(organization_id,service_id,note_type,title,content,source_label,created_by,updated_by)
      values($1,$2,$3,$4,$5,$6,$7,$7)
      returning id::text,organization_id::text,service_id::text,note_type,title,content,source_label,created_by::text,updated_by::text,created_at::text,updated_at::text`,
      [scope.organization_id,input.serviceId,value.noteType,value.title,value.content,value.sourceLabel,userId]);
    action="service.preparation_note.created";
  }
  const note=mapNote(result.rows[0]);
  await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
    values($1,'operator',$2,$3,'service_preparation_note',$4,$5::jsonb)`,
    [scope.organization_id,userId,action,note.id,JSON.stringify({serviceId:input.serviceId,noteType:note.noteType,title:note.title})]);
  return note;
}
