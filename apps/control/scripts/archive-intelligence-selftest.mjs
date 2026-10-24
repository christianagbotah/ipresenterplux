#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { loadPlannerServiceDetail } from "../src/lib/planner-service-queries.ts";
import {
  listArchivedServices,
  getArchivedService,
  listArchiveReuseTargets,
  reuseArchivedItemsInServicePlan
} from "../src/lib/archive.ts";

const source={
  archive:await readFile(new URL("../src/lib/archive.ts",import.meta.url),"utf8"),
  reuseRoute:await readFile(new URL("../src/app/api/v1/archive/[id]/reuse/route.ts",import.meta.url),"utf8"),
  reusePanel:await readFile(new URL("../src/components/archive/ArchiveReusePanel.tsx",import.meta.url),"utf8"),
  detail:await readFile(new URL("../src/components/archive/ArchiveServiceDetail.tsx",import.meta.url),"utf8"),
  detailPage:await readFile(new URL("../src/app/archive/[id]/page.tsx",import.meta.url),"utf8"),
  universal:await readFile(new URL("../src/lib/cockpit/search.ts",import.meta.url),"utf8"),
  palette:await readFile(new URL("../src/components/cockpit/CommandPalette.tsx",import.meta.url),"utf8")
};

for(const term of ["service_memories","service_memory_chapters","scripture_detections","transcript_segments"]){
  assert.match(source.archive,new RegExp(term),`Archive intelligence must search/read ${term}`);
}
assert.doesNotMatch(source.archive,/service_preparation_notes/,"Archive intelligence must not expose private preparation notes");
assert.match(source.archive,/createPlannerItem/,"Archive reuse must delegate mutations to Planner authority");
assert.match(source.reuseRoute,/If-Match|if-match/,"Archive reuse must require the target Planner revision");
assert.match(source.reuseRoute,/reuseArchivedItemsInServicePlan/,"Archive reuse API must delegate to the archive authority service");
assert.doesNotMatch(source.reuseRoute,/insert\s+into\s+presentation_items/i,"Archive reuse route must not create a second Planner mutation path");
assert.match(source.reusePanel,/Reuse selected in service plan/,"Archive reuse must be an explicit operator action");
assert.match(source.reusePanel,/min-h-11|min-h-12/,"Archive reuse controls must keep a 44px minimum target");
assert.doesNotMatch(source.reusePanel,/text-\[(?:10|11)px\]/,"Archive reuse operational copy must keep the 12px floor");
assert.doesNotMatch(source.reusePanel,/useEffect[\s\S]{0,500}(reuse|apply|POST)/i,"Archive reuse must not auto-apply on mount");
assert.match(source.detail,/Service memory/,"Archive detail must make retained service memory visible");
assert.match(source.detail,/ArchiveReusePanel/,"Archive detail must expose explicit reuse controls");
assert.match(source.detailPage,/listArchiveReuseTargets/,"Archive detail page must load only authorized reusable target services");
assert.match(source.universal,/"archive"/,"Universal Find must expose Archive as a read-only result domain");
assert.match(source.palette,/"Archive"/,"Universal Find UI must order and render Archive results");

if(!process.env.DATABASE_URL){
  console.log(JSON.stringify({ok:true,mode:"source-contract",database:"deferred-to-ci",memorySearch:true,explicitReuse:true,universalArchive:true,noPreparationLeak:true}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), otherCampus=randomUUID();
const user=randomUUID(), outsider=randomUUID(), sourceService=randomUUID(), targetService=randomUUID(), liveTarget=randomUUID(), foreignTarget=randomUUID();
const slide=randomUUID(), song=randomUUID(), now=new Date("2099-08-03T10:00:00Z");
try{
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Archive Intelligence Church',$2,'GH','Africa/Accra'),($3,'Other Archive Church',$4,'GH','Africa/Accra')`,[org,`archive-intel-${org}`,otherOrg,`other-archive-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH'),($3,$4,'Other','other','Kumasi','GH')`,[campus,org,otherCampus,otherOrg]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Archive Operator','active'),($3,$4,'Other Operator','active')`,[user,`archive-intel-${user}@example.invalid`,outsider,`other-${outsider}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator'),($3,$4,'presenter_operator')`,[user,org,outsider,otherOrg]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,ended_at,active_bible_version,updated_at) values
    ($1,$2,$3,'Love Conference','ended',$7,$7,$8,'WEBP',$8),
    ($4,$2,$3,'Next Sunday','draft',$9,null,null,'WEBP',$7),
    ($5,$2,$3,'Live Now','live',$7,$7,null,'WEBP',$7),
    ($6,$10,$11,'Foreign Draft','draft',$9,null,null,'WEBP',$7)`,
    [sourceService,org,campus,targetService,liveTarget,foreignTarget,now,new Date(now.getTime()+7200000),new Date(now.getTime()+7*86400000),otherOrg,otherCampus]);
  await client.query(`insert into presentation_items(id,service_id,item_type,title,content,sort_order,state,updated_at) values
    ($1,$3,'slide','Grace Welcome','{"title":"Grace Welcome","body":"Welcome into grace","footer":"Love Conference","style":"default"}'::jsonb,1000,'played',$5),
    ($2,$3,'song','Amazing Grace','{"title":"Amazing Grace","author":"John Newton","sections":[{"label":"Verse 1","text":"Amazing grace"}],"body":"Verse 1\\nAmazing grace","footer":"John Newton"}'::jsonb,2000,'played',$5),
    ($4,$6,'slide','Foreign Secret','{"title":"Foreign Secret","body":"private"}'::jsonb,1000,'queued',$5)`,
    [slide,song,sourceService,randomUUID(),now,foreignTarget]);
  await client.query(`insert into service_memories(service_id,organization_id,status,source_fingerprint,summary,key_scriptures,speakers,generator_version,generated_at) values
    ($1,$2,'ready',repeat('a',64),'Faith and covenant breakthrough message','[{"reference":"Romans 8:38-39"}]'::jsonb,'[{"id":"pastor-james","segments":7}]'::jsonb,'deterministic-v1',$3)`,[sourceService,org,now]);
  await client.query(`insert into service_memory_chapters(organization_id,service_id,ordinal,title,summary,source_kind,confidence) values
    ($1,$2,0,'Covenant Love','The pastor explains unbreakable covenant love','mixed',100)`,[org,sourceService]);
  await client.query(`insert into scripture_detections(service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal) values
    ($1,'John 3:16','John',3,16,16,'WEBP','For God so loved the world',98,'played','quote',$2,1)`,[sourceService,now]);
  await client.query(`insert into transcript_segments(service_id,text,source_observed_at,source_language,asr_confidence) values
    ($1,'Mercy rewrites every broken story',$2,'en',.96)`,[sourceService,now]);
  await client.query(`insert into service_preparation_notes(organization_id,service_id,note_type,title,content,created_by,updated_by) values
    ($1,$2,'sermon_notes','PRIVATESEARCHTOKEN','This private preparation note must never power Archive search',$3,$3)`,[org,sourceService,user]);

  for(const q of ["covenant breakthrough","Covenant Love","John 3:16","broken story","pastor-james"]){
    const result=await listArchivedServices(client,user,{organizationId:org,search:q,limit:10});
    assert.equal(result.services.some(s=>s.id===sourceService),true,`Archive search must match ${q}`);
  }
  const privateSearch=await listArchivedServices(client,user,{organizationId:org,search:"PRIVATESEARCHTOKEN",limit:10});
  assert.equal(privateSearch.services.length,0,"private preparation notes must not be searchable from Archive");
  const foreignSearch=await listArchivedServices(client,outsider,{organizationId:otherOrg,search:"covenant",limit:10});
  assert.equal(foreignSearch.services.some(s=>s.id===sourceService),false,"Archive intelligence must remain tenant-scoped");

  const detail=await getArchivedService(client,user,sourceService);
  assert.equal(detail.memory?.summary.includes("covenant breakthrough"),true);
  assert.equal(detail.memoryChapters.length,1);
  assert.equal(JSON.stringify(detail).includes("PRIVATESEARCHTOKEN"),false,"Archive detail must not expose preparation notes");

  const targets=await listArchiveReuseTargets(client,user,sourceService);
  assert.deepEqual(targets.map(t=>t.id),[targetService],"only same-org editable draft/ready services may be reuse targets");
  const targetDetail=await loadPlannerServiceDetail(client,user,targetService);
  const revision=targetDetail.revision;
  const reused=await reuseArchivedItemsInServicePlan(client,user,{sourceServiceId:sourceService,targetServiceId:targetService,sourceItemIds:[slide,song],expectedRevision:revision});
  assert.equal(reused.items.length,2);
  const targetItems=await client.query(`select title from presentation_items where service_id=$1 order by sort_order,id`,[targetService]);
  assert.deepEqual(targetItems.rows.map(r=>r.title),["Grace Welcome","Amazing Grace"]);
  const sourceItems=await client.query(`select count(*)::int c from presentation_items where service_id=$1`,[sourceService]);
  assert.equal(sourceItems.rows[0].c,2,"Archive reuse must never mutate the source service");
  await assert.rejects(()=>reuseArchivedItemsInServicePlan(client,user,{sourceServiceId:sourceService,targetServiceId:targetService,sourceItemIds:[slide],expectedRevision:revision}),e=>e?.code==="planner_revision_conflict","stale target revision must fail");
  await assert.rejects(()=>reuseArchivedItemsInServicePlan(client,user,{sourceServiceId:sourceService,targetServiceId:liveTarget,sourceItemIds:[slide],expectedRevision:"stale"}),/editable|current state|not editable/i,"live targets must not be mutated");
  await assert.rejects(()=>reuseArchivedItemsInServicePlan(client,user,{sourceServiceId:sourceService,targetServiceId:foreignTarget,sourceItemIds:[slide],expectedRevision:"stale"}),/not found|organization|tenant|target/i,"cross-tenant targets must fail");

  await client.query("rollback");
  console.log(JSON.stringify({ok:true,memorySearch:true,scriptureSearch:true,transcriptSearch:true,speakerSearch:true,noPreparationLeak:true,tenantIsolation:true,memoryDetail:true,explicitReuse:true,plannerAuthority:true,revisionConflict:true,sourceImmutable:true}));
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();await pool.end();}
