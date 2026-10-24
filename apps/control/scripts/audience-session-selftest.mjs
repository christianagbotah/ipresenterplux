#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { AudienceSessionError, touchAudienceSession } from "../src/lib/audience-session.ts";

const files={
  migration:"../db/045_audience_sessions.sql",
  authority:"../src/lib/audience-session.ts",
  route:"../src/app/api/v1/audience/session/route.ts",
  publicService:"../src/lib/public-audience-service.ts",
  liveAudience:"../src/components/audience/LiveAudience.tsx",
  studioPage:"../src/app/audience/page.tsx"
};
for(const relative of Object.values(files)) await access(new URL(relative,import.meta.url));
const source=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,relative])=>[key,await readFile(new URL(relative,import.meta.url),"utf8")] )));

assert.match(source.migration,/create table if not exists audience_sessions/i);
assert.match(source.migration,/service_id uuid not null references services/i);
assert.match(source.migration,/language_channel_id uuid references language_channels/i);
assert.match(source.migration,/last_seen_at timestamptz/i);
assert.match(source.migration,/idx_audience_sessions_service_seen/i);
assert.doesNotMatch(source.migration,/ip_address|user_agent|fingerprint|device_name|email/i,"anonymous audience sessions must not persist fingerprinting or identity fields");
assert.match(source.authority,/touchAudienceSession/);
assert.match(source.authority,/45 seconds|45_000|AUDIENCE_SESSION_ACTIVE/i);
assert.match(source.authority,/service.*status.*live/is,"session authority must reject non-live services");
assert.match(source.authority,/language_channels/is,"language selection must be scoped through an enabled organization channel");
assert.match(source.route,/touchAudienceSession/);
assert.match(source.route,/publishServiceEvent/);
assert.match(source.route,/language\.channel\.changed/);
assert.match(source.route,/Cache-Control["']?\s*:\s*["']no-store/);
assert.match(source.publicService,/audience_sessions/);
assert.match(source.publicService,/interval '45 seconds'/);
assert.doesNotMatch(source.publicService,/listener_count as listeners/i,"public listener counts must derive from active audience sessions");
assert.match(source.studioPage,/audience_sessions/);
assert.match(source.studioPage,/interval '45 seconds'/);
assert.doesNotMatch(source.studioPage,/select language_name,channel_mode,listener_count/i,"Audience Studio must show real active-session demand");
assert.match(source.liveAudience,/\/api\/v1\/audience\/session/);
assert.match(source.liveAudience,/crypto\.randomUUID/);
assert.match(source.liveAudience,/20_000|20000/);
assert.match(source.liveAudience,/ipresenterplux-audience-session:/);
assert.match(source.liveAudience,/ipresenterplux-language:/,"language preference must be service-scoped");
assert.doesNotMatch(source.liveAudience,/navigator\.userAgent|deviceMemory|hardwareConcurrency|canvas/i,"public audience client must not fingerprint devices");

if (existsSync(".env.local")) process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci",anonymousSession:true,activeWindowSeconds:45,heartbeatSeconds:20,serviceScopedLanguage:true,privacyFieldsStored:false}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), service=randomUUID(), readyService=randomUUID(), otherService=randomUUID();
const channelA=randomUUID(), channelB=randomUUID(), disabledChannel=randomUUID(), foreignChannel=randomUUID(), session=randomUUID();
const t0=new Date("2099-01-01T10:00:00.000Z");
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values
    ($1,'Audience Session Church',$3,'GH','Africa/Accra'),
    ($2,'Foreign Session Church',$4,'GH','Africa/Accra')`,[org,otherOrg,`aud-session-${org}`,`aud-session-other-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main',$3,'Accra','GH')`,[campus,org,`aud-session-${campus}`]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at) values
    ($1,$4,$5,'Live Audience','live',$6,$6),
    ($2,$4,$5,'Ready Audience','ready',$6,null),
    ($3,$7,null,'Foreign Live','live',$6,$6)`,[service,readyService,otherService,org,campus,t0,otherOrg]);
  await client.query(`insert into language_channels(id,organization_id,language_code,language_name,channel_mode,enabled) values
    ($1,$5,'fr','French','translation_text',true),
    ($2,$5,'ak','Twi','translation_audio',true),
    ($3,$5,'ee','Disabled Ewe','translation_text',false),
    ($4,$6,'fr','Foreign French','translation_text',true)`,[channelA,channelB,disabledChannel,foreignChannel,org,otherOrg]);

  const first=await touchAudienceSession(client,{sessionId:session,serviceId:service,languageChannelId:channelA,now:t0});
  assert.equal(first.changed,true,"new audience session must refresh demand");
  const same=await touchAudienceSession(client,{sessionId:session,serviceId:service,languageChannelId:channelA,now:new Date(t0.getTime()+20_000)});
  assert.equal(same.changed,false,"normal heartbeat inside active window must not broadcast demand change");
  const switched=await touchAudienceSession(client,{sessionId:session,serviceId:service,languageChannelId:channelB,now:new Date(t0.getTime()+25_000)});
  assert.equal(switched.changed,true,"language change must refresh demand");
  const returned=await touchAudienceSession(client,{sessionId:session,serviceId:service,languageChannelId:channelB,now:new Date(t0.getTime()+71_000)});
  assert.equal(returned.changed,true,"session returning after 45 seconds must become active again");

  const active=await client.query(`select count(*)::int as count from audience_sessions where service_id=$1::uuid and language_channel_id=$2::uuid and last_seen_at >= $3::timestamptz-interval '45 seconds'`,[service,channelB,new Date(t0.getTime()+71_000)]);
  assert.equal(active.rows[0].count,1,"active listener aggregation must count the live session once");

  await assert.rejects(()=>touchAudienceSession(client,{sessionId:randomUUID(),serviceId:service,languageChannelId:disabledChannel,now:t0}),error=>error instanceof AudienceSessionError && error.code==="audience_language_unavailable");
  await assert.rejects(()=>touchAudienceSession(client,{sessionId:randomUUID(),serviceId:service,languageChannelId:foreignChannel,now:t0}),error=>error instanceof AudienceSessionError && error.code==="audience_language_unavailable");
  await assert.rejects(()=>touchAudienceSession(client,{sessionId:randomUUID(),serviceId:readyService,languageChannelId:channelA,now:t0}),error=>error instanceof AudienceSessionError && error.code==="audience_service_not_live");
  await assert.rejects(()=>touchAudienceSession(client,{sessionId:session,serviceId:otherService,languageChannelId:foreignChannel,now:t0}),error=>error instanceof AudienceSessionError && error.code==="audience_session_scope_conflict");

  const row=await client.query(`select id::text,service_id::text,language_channel_id::text,last_seen_at::text from audience_sessions where id=$1::uuid`,[session]);
  assert.equal(row.rowCount,1);
  assert.equal(row.rows[0].service_id,service);
  assert.equal(row.rows[0].language_channel_id,channelB);
  console.log(JSON.stringify({ok:true,mode:"postgres",anonymousSession:true,activeWindowSeconds:45,heartbeatSeconds:20,serviceScopedLanguage:true,privacyFieldsStored:false,tenantIsolation:true,nonLiveRejected:true,scopeConflictRejected:true}));
} finally {
  await client.query("rollback");
  await client.end();
}
