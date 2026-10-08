#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const root = path.resolve(import.meta.dirname, "..");
const helperPath = path.join(root, "src/lib/public-audience-service.ts");
assert.ok(existsSync(helperPath), "public audience service loader must exist");
const { loadPublicAudienceService } = await import("../src/lib/public-audience-service.ts");

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");

const orgId = randomUUID();
const foreignOrgId = randomUUID();
const campusId = randomUUID();

async function insertService(status, label) {
  const id = randomUUID();
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,$3,$4,$5,'WEBP')`,
    [id, orgId, campusId, `Audience ${label}`, status]
  );
  return id;
}

try {
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone) values
      ($1,'Audience State Test',$3,'GH','Africa/Accra'),
      ($2,'Foreign Audience Test',$4,'GH','Africa/Accra')`,
    [orgId, foreignOrgId, `audience-${orgId}`, `audience-foreign-${foreignOrgId}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Audience Campus',$3,'Accra','GH')`,
    [campusId, orgId, `audience-${campusId}`]
  );
  await client.query(
    `insert into language_channels(organization_id,language_code,language_name,channel_mode,enabled)
     values ($1,'fr','Foreign French','translation_text',true)`,
    [foreignOrgId]
  );

  const readyId = await insertService("ready", "Ready");
  const endedId = await insertService("ended", "Ended");
  const liveId = await insertService("live", "Live");

  const ready = await loadPublicAudienceService(client, readyId);
  assert.deepEqual(Object.keys(ready).sort(), ["service"], "ready service must expose identity/status only");
  assert.equal(ready.service.status, "ready");
  assert.equal("languages" in ready, false, "ready service must not leak live languages");

  const ended = await loadPublicAudienceService(client, endedId);
  assert.deepEqual(Object.keys(ended).sort(), ["service"], "ended service must expose identity/status only");
  assert.equal(ended.service.status, "ended");

  const live = await loadPublicAudienceService(client, liveId);
  assert.equal(live.service.status, "live");
  for (const key of ["languages", "scripture", "transcript"]) assert.ok(key in live, `live payload must include ${key}`);
  assert.deepEqual(live.languages, [], "language lookup must stay scoped to the live service organization");

  assert.equal(await loadPublicAudienceService(client, randomUUID()), null, "unknown valid UUID must be unavailable");

  const apiSource = readFileSync(path.join(root, "src/app/api/v1/audience/service/[id]/route.ts"), "utf8");
  assert.match(apiSource, /loadPublicAudienceService/u, "public API must use the shared state-aware loader");
  assert.match(apiSource, /Cache-Control[^\n]*no-store/u, "public audience API must disable caching");

  const pageSource = readFileSync(path.join(root, "src/app/live/page.tsx"), "utf8");
  for (const copy of ["This live link is invalid", "This service link is unavailable", "is not live yet", "This service has ended"]) {
    assert.match(pageSource, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `live page must expose ${copy}`);
  }
  const realtimeUses = pageSource.match(/<AudienceRealtimeRefresh/g) ?? [];
  assert.ok(realtimeUses.length >= 2, "waiting and live states must both use realtime refresh");

  const eventsSource = readFileSync(path.join(root, "src/app/api/v1/audience/events/route.ts"), "utf8");
  assert.doesNotMatch(eventsSource, /where id=\$1 and status='live'/u, "audience SSE must accept valid waiting services so live transitions arrive in realtime");
  assert.match(eventsSource, /publicRefreshEvents/u, "audience SSE must keep an explicit public event allowlist");

  const realtimeSource = readFileSync(path.join(root, "src/components/audience/AudienceRealtimeRefresh.tsx"), "utf8");
  assert.match(realtimeSource, /setInterval\(refresh, 5_000\)/u, "realtime fallback must poll every five seconds");

  console.log(JSON.stringify({ ok: true, invalid: true, waiting: true, live: true, ended: true, unavailable: true, nonLiveMinimal: true, pollSeconds: 5 }));
} finally {
  await client.query("rollback");
  await client.end();
}
