#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  listCockpitRecommendations,
  upsertCockpitRecommendation,
  setCockpitRecommendationState,
  listServicePins,
  setServicePin
} from "../src/lib/cockpit/recommendations.ts";

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci"}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), otherCampus=randomUUID(), operator=randomUUID(), outsider=randomUUID(), service=randomUUID(), otherService=randomUUID();
const now=new Date("2099-05-01T10:00:00.000Z");
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Cockpit Rec Church',$2,'GH','Africa/Accra'),($3,'Other Church',$4,'GH','Africa/Accra')`,[org,`rec-${org}`,otherOrg,`rec-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH'),($3,$4,'Other','other','Accra','GH')`,[campus,org,otherCampus,otherOrg]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Operator','active'),($3,$4,'Outsider','active')`,[operator,`op-${operator}@example.invalid`,outsider,`out-${outsider}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator'),($3,$4,'presenter_operator')`,[operator,org,outsider,otherOrg]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,active_bible_version) values ($1,$2,$3,'Live','live','2099-05-01T09:00:00Z','WEBP'),($4,$5,$6,'Other','live','2099-05-01T09:00:00Z','WEBP')`,[service,org,campus,otherService,otherOrg,otherCampus]);

  const first=await upsertCockpitRecommendation(client,{organizationId:org,serviceId:service,sourceKey:"scripture:john-3-16",recommendationType:"scripture.preview",targetType:"scripture_detection",targetId:randomUUID(),payload:{reference:"John 3:16"},confidence:97,reason:"Explicit reference detected",evidence:"John chapter three verse sixteen",sourceObservedAt:new Date("2099-05-01T09:59:50Z"),expiresAt:new Date("2099-05-01T10:01:50Z"),now});
  const second=await upsertCockpitRecommendation(client,{organizationId:org,serviceId:service,sourceKey:"scripture:john-3-16",recommendationType:"scripture.preview",targetType:"scripture_detection",targetId:first.targetId,payload:{reference:"John 3:16"},confidence:98,reason:"Repeated observation",evidence:"John 3:16",sourceObservedAt:new Date("2099-05-01T09:59:55Z"),expiresAt:new Date("2099-05-01T10:01:55Z"),now});
  assert.equal(second.id,first.id,"same source identity must upsert idempotently");
  assert.equal(second.confidence,98);

  await upsertCockpitRecommendation(client,{organizationId:org,serviceId:service,sourceKey:"planned:closing",recommendationType:"planner.next",targetType:"presentation_item",targetId:randomUUID(),payload:{},confidence:80,reason:"Next planned item",evidence:"Rundown order",sourceObservedAt:new Date("2099-05-01T09:59:40Z"),expiresAt:new Date("2099-05-01T10:02:00Z"),now});
  let listed=await listCockpitRecommendations(client,{organizationId:org,serviceId:service,now});
  assert.deepEqual(listed.map(x=>x.sourceKey),["scripture:john-3-16","planned:closing"],"ordering must be deterministic by confidence then recency/id");

  const dismissed=await setCockpitRecommendationState(client,operator,{recommendationId:first.id,state:"dismissed",now});
  assert.equal(dismissed.state,"dismissed");
  const repeated=await upsertCockpitRecommendation(client,{organizationId:org,serviceId:service,sourceKey:"scripture:john-3-16",recommendationType:"scripture.preview",targetType:"scripture_detection",targetId:first.targetId,payload:{},confidence:99,reason:"Late duplicate",evidence:"repeat",sourceObservedAt:new Date("2099-05-01T10:00:05Z"),expiresAt:new Date("2099-05-01T10:02:05Z"),now});
  assert.equal(repeated.state,"dismissed","AI upsert must not resurrect dismissed operator state");
  const dismissedAgain=await setCockpitRecommendationState(client,operator,{recommendationId:first.id,state:"dismissed",now});
  assert.equal(dismissedAgain.state,"dismissed","repeated dismiss must be idempotent");

  const expiring=await upsertCockpitRecommendation(client,{organizationId:org,serviceId:service,sourceKey:"camera:old",recommendationType:"camera.recommend",targetType:"media_source",targetId:randomUUID(),payload:{},confidence:90,reason:"Old camera",evidence:"stale",sourceObservedAt:new Date("2099-05-01T09:55:00Z"),expiresAt:new Date("2099-05-01T09:59:59Z"),now:new Date("2099-05-01T09:59:00Z")});
  listed=await listCockpitRecommendations(client,{organizationId:org,serviceId:service,now});
  assert.equal(listed.find(x=>x.id===expiring.id)?.state,"expired","stale recommendation must expire before it remains actionable");

  const pin=await setServicePin(client,operator,{organizationId:org,serviceId:service,targetType:"presentation_item",targetId:"closing",title:"Closing Prayer",payload:{source:"manual"},pinned:true,now});
  assert.ok(pin);
  const pins=await listServicePins(client,{organizationId:org,serviceId:service});
  assert.equal(pins.length,1); assert.equal(pins[0].title,"Closing Prayer");
  const pinAgain=await setServicePin(client,operator,{organizationId:org,serviceId:service,targetType:"presentation_item",targetId:"closing",title:"Closing Prayer",payload:{source:"manual"},pinned:true,now});
  assert.equal(pinAgain?.id,pin.id,"repeat pin must be idempotent");

  await assert.rejects(()=>setCockpitRecommendationState(client,outsider,{recommendationId:first.id,state:"accepted",now}),/not found|forbidden/i,"cross-organization operator cannot mutate recommendation");
  await assert.rejects(()=>setServicePin(client,outsider,{organizationId:org,serviceId:service,targetType:"presentation_item",targetId:"x",title:"X",payload:{},pinned:true,now}),(error)=>error?.status===403 && error?.code==="cockpit_operator_forbidden","cross-organization pin must be denied");

  const audits=await client.query(`select action from audit_events where organization_id=$1 and action like 'cockpit.%' order by created_at,id`,[org]);
  assert.ok(audits.rows.some(r=>r.action==='cockpit.recommendation.state.updated'));
  assert.ok(audits.rows.some(r=>r.action==='cockpit.pin.updated'));
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/lib/cockpit/recommendations.ts",import.meta.url),"utf8"));
  assert.doesNotMatch(source,/program\.show|program\.take|program\.clear/,"recommendation persistence must never mutate Program");
  await client.query("rollback");
  console.log(JSON.stringify({ok:true,idempotentUpsert:true,dismissPreserved:true,staleExpiry:true,sharedPins:true,tenantIsolation:true,audit:true,noProgramMutation:true}));
} catch(e){await client.query("rollback").catch(()=>{});throw e;} finally {client.release();await pool.end();}
