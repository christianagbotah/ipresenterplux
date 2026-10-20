#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { upsertServicePreparationNote } from "../src/lib/service-intelligence/notes.ts";
import { buildServicePreparationContext } from "../src/lib/service-intelligence/preparation.ts";

if (!process.env.DATABASE_URL) { console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci"})); process.exit(0); }
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
const now=new Date("2099-06-15T09:00:00Z");
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), otherCampus=randomUUID(), user=randomUUID();
const current=randomUUID(), previous=randomUUID(), otherPrevious=randomUUID(), edge=randomUUID();
const reusableSong=randomUUID(), secretSong=randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Prep Church',$2,'GH','Africa/Accra'),($3,'Secret Church',$4,'GH','Africa/Accra')`,[org,`prep-${org}`,otherOrg,`secret-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH'),($3,$4,'Secret','secret','Kumasi','GH')`,[campus,org,otherCampus,otherOrg]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Planner','active')`,[user,`planner-${user}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator')`,[user,org]);
  await client.query(`insert into services(id,organization_id,campus_id,title,service_type,status,scheduled_start,active_bible_version,ended_at) values
    ($1,$2,$3,'Coming Sunday','sunday_service','draft',$4,'WEBP',null),
    ($5,$2,$3,'Previous Sunday','sunday_service','ended',$6,'WEBP',$7),
    ($8,$9,$10,'Secret Sunday','sunday_service','ended',$6,'WEBP',$7)`,
    [current,org,campus,new Date(now.getTime()+86400000),previous,new Date(now.getTime()-7*86400000),new Date(now.getTime()-7*86400000+7200000),otherPrevious,otherOrg,otherCampus]);
  await client.query(`insert into presentation_items(service_id,item_type,title,content,sort_order,state) values
    ($1,'slide','Welcome','{"body":"Welcome"}'::jsonb,1000,'queued'),
    ($2,'song','Amazing Grace','{"sections":[{"label":"Verse 1","text":"Amazing grace"}]}'::jsonb,1000,'played'),
    ($2,'slide','Closing Prayer','{"body":"Prayer"}'::jsonb,2000,'played'),
    ($3,'song','Secret Song','{"sections":[{"label":"Verse","text":"secret"}]}'::jsonb,1000,'played')`,[current,previous,otherPrevious]);
  await client.query(`insert into media_library_items(id,organization_id,item_type,title,planner_input,created_by,updated_at) values
    ($1,$2,'song','Amazing Grace',$3::jsonb,$4,$5),
    ($6,$7,'song','Secret Song',$8::jsonb,null,$5)`,
    [reusableSong,org,JSON.stringify({title:'Amazing Grace',author:'John Newton',sections:[{label:'Verse 1',text:'Amazing grace'}]}),user,new Date(now.getTime()-2*86400000),secretSong,otherOrg,JSON.stringify({title:'Secret Song',sections:[{label:'Verse',text:'secret'}]})]);
  await client.query(`insert into service_memories(service_id,organization_id,status,source_fingerprint,summary,key_scriptures,speakers,songs_media,incidents,languages_outputs,generator_version,generated_at) values
    ($1,$2,'ready',repeat('a',64),'Previous message about grace and faith','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,'deterministic-v1',$3),
    ($4,$5,'ready',repeat('b',64),'Secret tenant memory','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,'deterministic-v1',$3)`,[previous,org,new Date(now.getTime()-7*86400000+7200000),otherPrevious,otherOrg]);
  await client.query(`insert into output_destinations(organization_id,name,destination_type,enabled,status,public_config) values
    ($1,'YouTube','youtube',true,'ready','{}'::jsonb),($1,'Backup RTMP','rtmp',true,'error','{}'::jsonb)`,[org]);
  await client.query(`insert into language_channels(organization_id,language_code,language_name,channel_mode,enabled,listener_count) values
    ($1,'en','English','original',true,0),($1,'fr','French','translation_audio',true,0)`,[org]);
  await client.query(`insert into edge_devices(id,organization_id,campus_id,name,platform,status,credential_hash,last_seen_at) values ($1,$2,$3,'Sanctuary Edge','windows','active',repeat('c',64),$4)`,[edge,org,campus,new Date(now.getTime()-30000)]);
  await upsertServicePreparationNote(client,user,{serviceId:current,noteType:'sermon_notes',title:'Love Without End',content:'Main text John 3:16. Close with Romans 8:38-39. Emphasize grace.',sourceLabel:'Pastor sermon notes'});

  const before=await client.query(`select (select count(*)::int from presentation_items where service_id=$1) as items,(select count(*)::int from audit_events where organization_id=$2) as audits`,[current,org]);
  const first=await buildServicePreparationContext(client,user,current,{now});
  const second=await buildServicePreparationContext(client,user,current,{now});
  assert.deepEqual(second,first,"same source truth must produce deterministic preparation context");
  assert.equal(first.service.id,current); assert.equal(first.service.status,'draft');
  assert.ok(first.notes.some(n=>n.title==='Love Without End'));
  const refs=first.suggestions.filter(s=>s.kind==='scripture_reference').map(s=>s.title);
  assert.ok(refs.some(v=>/John 3:16/.test(v))); assert.ok(refs.some(v=>/Romans 8:38-39/.test(v)));
  const grace=first.suggestions.find(s=>s.kind==='history_reuse' && s.title==='Amazing Grace');
  assert.ok(grace,"same-type previous service reusable song should be suggested");
  assert.equal(grace.plannerCandidate?.itemType,'song'); assert.equal(grace.sourceServiceId,previous); assert.ok(grace.sourceObservedAt);
  assert.ok(first.suggestions.some(s=>s.kind==='history_context' && /Previous Sunday/.test(s.title) && /grace and faith/i.test(s.evidence)));
  assert.ok(!JSON.stringify(first).includes('Secret Song')); assert.ok(!JSON.stringify(first).includes('Secret tenant memory'));
  assert.deepEqual(first.readiness.outputs,{enabled:2,healthy:1,degraded:1});
  assert.equal(first.readiness.languages.enabled,2); assert.equal(first.readiness.edge.freshness,'current'); assert.equal(first.readiness.edge.name,'Sanctuary Edge');
  assert.ok(first.suggestions.every(s=>typeof s.reason==='string' && s.reason.length>0 && typeof s.confidence==='number'));
  const after=await client.query(`select (select count(*)::int from presentation_items where service_id=$1) as items,(select count(*)::int from audit_events where organization_id=$2) as audits`,[current,org]);
  assert.deepEqual(after.rows[0],before.rows[0],"preparation projection must be read-only");

  await client.query("rollback");
  console.log(JSON.stringify({ok:true,scriptureFromNotes:true,historyReuse:true,libraryPayload:true,readiness:true,tenantIsolation:true,deterministic:true,readOnly:true}));
} catch(e){await client.query("rollback").catch(()=>{});throw e;} finally{client.release();await pool.end();}
