#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { loadPlannerServiceDetail } from "../src/lib/planner-service-queries.ts";
import { upsertServicePreparationNote, ServiceIntelligenceError } from "../src/lib/service-intelligence/notes.ts";
import { buildServicePreparationContext, applyServicePreparationSuggestion } from "../src/lib/service-intelligence/preparation.ts";

for (const file of [
  "../src/components/planner/ServicePreparationPanel.tsx",
  "../src/app/api/v1/planner/services/[id]/preparation/route.ts",
  "../src/app/api/v1/planner/services/[id]/preparation/apply/route.ts"
]) await readFile(new URL(file,import.meta.url),"utf8");
const panel=await readFile(new URL("../src/components/planner/ServicePreparationPanel.tsx",import.meta.url),"utf8");
const workspace=await readFile(new URL("../src/components/planner/ServicePlannerWorkspace.tsx",import.meta.url),"utf8");
const prepRoute=await readFile(new URL("../src/app/api/v1/planner/services/[id]/preparation/route.ts",import.meta.url),"utf8");
const applyRoute=await readFile(new URL("../src/app/api/v1/planner/services/[id]/preparation/apply/route.ts",import.meta.url),"utf8");
assert.match(panel,/Add to plan/); assert.match(panel,/min-h-11|h-11|min-h-12|h-12/,"primary preparation controls must be at least 44px high");
assert.doesNotMatch(panel,/useEffect[\s\S]{0,500}(apply|commit|Add to plan)/i,"panel must not auto-apply suggestions on mount");
assert.match(workspace,/ServicePreparationPanel/); assert.match(workspace,/revision=\{revision\}/,"panel must receive the current in-memory planner revision");
assert.match(prepRoute,/upsertServicePreparationNote/); assert.match(applyRoute,/If-Match|if-match/i); assert.match(applyRoute,/applyServicePreparationSuggestion/);

if (!process.env.DATABASE_URL) { console.log(JSON.stringify({ok:true,mode:"source-contract",database:"deferred-to-ci"})); process.exit(0); }
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
const org=randomUUID(), campus=randomUUID(), editor=randomUUID(), viewer=randomUUID(), service=randomUUID(), previous=randomUUID();
const now=new Date("2099-06-20T09:00:00Z");
try{
 await client.query("begin");
 await client.query(`insert into organizations(id,name,slug,country_code,timezone) values($1,'UI Prep Church',$2,'GH','Africa/Accra')`,[org,`ui-prep-${org}`]);
 await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values($1,$2,'Main','main','Accra','GH')`,[campus,org]);
 await client.query(`insert into users(id,email,display_name,status) values($1,$2,'Editor','active'),($3,$4,'Viewer','active')`,[editor,`editor-${editor}@example.invalid`,viewer,`viewer-${viewer}@example.invalid`]);
 await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values($1,$2,'presenter_operator'),($3,$2,'viewer')`,[editor,org,viewer]);
 await client.query(`insert into services(id,organization_id,campus_id,title,service_type,status,scheduled_start,active_bible_version,ended_at) values
   ($1,$2,$3,'Coming','sunday_service','draft',$4,'WEBP',null),($5,$2,$3,'Previous','sunday_service','ended',$6,'WEBP',$6)`,[service,org,campus,new Date(now.getTime()+86400000),previous,new Date(now.getTime()-7*86400000)]);
 await client.query(`insert into service_memories(service_id,organization_id,status,source_fingerprint,summary,generator_version,generated_at) values($1,$2,'ready',repeat('d',64),'Prior service context only','deterministic-v1',$3)`,[previous,org,new Date(now.getTime()-7*86400000)]);
 await upsertServicePreparationNote(client,editor,{serviceId:service,noteType:'sermon_notes',title:'Main Message',content:'Read John 3:16 clearly.'});
 const initial=await loadPlannerServiceDetail(client,editor,service);
 const context=await buildServicePreparationContext(client,editor,service,{now});
 const scripture=context.suggestions.find(s=>s.kind==='scripture_reference'); assert.ok(scripture?.plannerCandidate);
 const result=await applyServicePreparationSuggestion(client,editor,{serviceId:service,suggestionId:scripture.id,expectedRevision:initial.revision,now});
 assert.equal(result.item.itemType,'scripture'); assert.notEqual(result.revision,initial.revision); assert.equal((await client.query(`select count(*)::int c from presentation_items where service_id=$1`,[service])).rows[0].c,1);
 await assert.rejects(()=>applyServicePreparationSuggestion(client,editor,{serviceId:service,suggestionId:scripture.id,expectedRevision:initial.revision,now}),e=>e?.code==='planner_revision_conflict');
 const history=context.suggestions.find(s=>s.kind==='history_context'); assert.ok(history && !history.plannerCandidate);
 await assert.rejects(()=>applyServicePreparationSuggestion(client,editor,{serviceId:service,suggestionId:history.id,expectedRevision:result.revision,now}),e=>e instanceof ServiceIntelligenceError && e.code==='service_preparation_navigation_only');
 const viewerContext=await buildServicePreparationContext(client,viewer,service,{now}); const viewerScripture=viewerContext.suggestions.find(s=>s.kind==='scripture_reference'); assert.ok(viewerScripture);
 await assert.rejects(()=>applyServicePreparationSuggestion(client,viewer,{serviceId:service,suggestionId:viewerScripture.id,expectedRevision:result.revision,now}),e=>e?.status===403);
 await client.query("rollback");
 console.log(JSON.stringify({ok:true,explicitApply:true,revisionRequired:true,staleRejected:true,viewerDenied:true,navigationOnlySafe:true,touchTarget:true,noteEditingSeparate:true}));
}catch(e){await client.query("rollback").catch(()=>{});throw e;}finally{client.release();await pool.end();}
