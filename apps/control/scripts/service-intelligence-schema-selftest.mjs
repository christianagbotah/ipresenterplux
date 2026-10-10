#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  listServicePreparationNotes,
  upsertServicePreparationNote,
  ServiceIntelligenceError
} from "../src/lib/service-intelligence/notes.ts";

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci"}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), otherCampus=randomUUID();
const editor=randomUUID(), viewer=randomUUID(), outsider=randomUUID(), service=randomUUID(), otherService=randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values
    ($1,'Memory Church',$2,'GH','Africa/Accra'),($3,'Other Church',$4,'GH','Africa/Accra')`,[org,`memory-${org}`,otherOrg,`other-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values
    ($1,$2,'Main','main','Accra','GH'),($3,$4,'Other','other','Kumasi','GH')`,[campus,org,otherCampus,otherOrg]);
  await client.query(`insert into users(id,email,display_name,status) values
    ($1,$2,'Editor','active'),($3,$4,'Viewer','active'),($5,$6,'Outsider','active')`,
    [editor,`editor-${editor}@example.invalid`,viewer,`viewer-${viewer}@example.invalid`,outsider,`outsider-${outsider}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values
    ($1,$2,'presenter_operator'),($3,$2,'viewer'),($4,$5,'presenter_operator')`,[editor,org,viewer,outsider,otherOrg]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,active_bible_version) values
    ($1,$2,$3,'Sunday Service','draft',now()+interval '2 days','WEBP'),
    ($4,$5,$6,'Other Service','draft',now()+interval '2 days','WEBP')`,[service,org,campus,otherService,otherOrg,otherCampus]);
  await client.query(`insert into presentation_items(service_id,item_type,title,content,sort_order,state) values ($1,'slide','Welcome','{}'::jsonb,1000,'queued')`,[service]);
  const before=await client.query(`select status,updated_at::text,(select count(*)::int from presentation_items where service_id=$1) as item_count from services where id=$1`,[service]);

  const note=await upsertServicePreparationNote(client,editor,{serviceId:service,noteType:'sermon_notes',title:'The Love of God',content:'Main text: John 3:16\nClosing: Romans 8:38-39',sourceLabel:'Pastor notes'});
  assert.equal(note.serviceId,service); assert.equal(note.organizationId,org); assert.equal(note.noteType,'sermon_notes');
  const listed=await listServicePreparationNotes(client,viewer,service);
  assert.equal(listed.length,1); assert.equal(listed[0].id,note.id,"organization member may read preparation notes");
  await assert.rejects(()=>listServicePreparationNotes(client,outsider,service),(e)=>e instanceof ServiceIntelligenceError && e.status===404,"cross-tenant read must not reveal service/note existence");
  await assert.rejects(()=>upsertServicePreparationNote(client,viewer,{serviceId:service,noteType:'service_notes',title:'No',content:'Viewer cannot edit'}),(e)=>e instanceof ServiceIntelligenceError && e.status===403,"viewer cannot mutate notes");
  await assert.rejects(()=>upsertServicePreparationNote(client,editor,{serviceId:service,noteType:'sermon_notes',title:'Too long',content:'x'.repeat(100001)}),(e)=>e instanceof ServiceIntelligenceError && e.code==='service_note_too_large',"note body must be bounded at 100k characters");

  const updated=await upsertServicePreparationNote(client,editor,{serviceId:service,noteId:note.id,noteType:'sermon_notes',title:'The Love of God',content:'Main text: John 3:16\nClosing: Romans 8:38-39\nPrayer',sourceLabel:'Pastor notes'});
  assert.equal(updated.id,note.id); assert.match(updated.content,/Prayer$/);
  const after=await client.query(`select status,updated_at::text,(select count(*)::int from presentation_items where service_id=$1) as item_count from services where id=$1`,[service]);
  assert.equal(after.rows[0].status,before.rows[0].status,"note writes must not change service state");
  assert.equal(after.rows[0].item_count,before.rows[0].item_count,"note writes must not mutate rundown");

  const tables=await client.query(`select table_name from information_schema.tables where table_schema='public' and table_name=any($1::text[]) order by table_name`,[['service_memories','service_memory_chapters','service_preparation_notes']]);
  assert.deepEqual(tables.rows.map(r=>r.table_name),['service_memories','service_memory_chapters','service_preparation_notes']);
  const memoryCols=await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='service_memories'`);
  const names=new Set(memoryCols.rows.map(r=>r.column_name));
  for(const name of ['service_id','organization_id','status','source_fingerprint','summary','key_scriptures','speakers','songs_media','incidents','languages_outputs','generator_version','generated_at','last_error']) assert.ok(names.has(name),`service_memories.${name} required`);
  const audits=await client.query(`select action from audit_events where organization_id=$1 and entity_type='service_preparation_note' order by created_at,id`,[org]);
  assert.ok(audits.rows.some(r=>r.action==='service.preparation_note.created'));
  assert.ok(audits.rows.some(r=>r.action==='service.preparation_note.updated'));

  await client.query("rollback");
  console.log(JSON.stringify({ok:true,tenantScoped:true,plannerRoleWrites:true,memberReads:true,noteLimit:100000,audit:true,serviceStateUntouched:true,memoryContracts:true}));
} catch(e) { await client.query("rollback").catch(()=>{}); throw e; }
finally { client.release(); await pool.end(); }
