import type { PoolClient } from "pg";

export const AUDIENCE_SESSION_ACTIVE_MS = 45_000;
const AUDIENCE_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

type ExistingSession = {
  service_id: string;
  language_channel_id: string | null;
  last_seen_at: string;
};

export class AudienceSessionError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AudienceSessionError";
    this.status = status;
    this.code = code;
  }
}

export async function touchAudienceSession(
  client: Pick<PoolClient,"query">,
  input: { sessionId:string; serviceId:string; languageChannelId:string|null; now?:Date }
) {
  const now=input.now ?? new Date();
  const service=await client.query<{id:string;organization_id:string;status:string}>(
    `select id::text,organization_id::text,status from services where id=$1::uuid limit 1`,
    [input.serviceId]
  );
  const currentService=service.rows[0];
  if(!currentService || currentService.status!=="live") {
    throw new AudienceSessionError(404,"audience_service_not_live","Audience session is only available for a live service");
  }

  if(input.languageChannelId) {
    const channel=await client.query<{id:string}>(
      `select id::text from language_channels
       where id=$1::uuid and organization_id=$2::uuid and enabled=true limit 1`,
      [input.languageChannelId,currentService.organization_id]
    );
    if(!channel.rowCount) throw new AudienceSessionError(404,"audience_language_unavailable","Audience language is not available for this service");
  }

  const existing=await client.query<ExistingSession>(
    `select service_id::text,language_channel_id::text,last_seen_at::text
       from audience_sessions where id=$1::uuid for update`,
    [input.sessionId]
  );
  const previous=existing.rows[0];
  if(previous && previous.service_id!==input.serviceId) {
    throw new AudienceSessionError(409,"audience_session_scope_conflict","Audience session belongs to another service");
  }
  const previousSeen=previous ? new Date(previous.last_seen_at).getTime() : Number.NaN;
  const wasActive=Number.isFinite(previousSeen) && now.getTime()-previousSeen <= AUDIENCE_SESSION_ACTIVE_MS;
  const changed=!previous || !wasActive || previous.language_channel_id!==input.languageChannelId;

  await client.query(
    `insert into audience_sessions(id,service_id,language_channel_id,created_at,last_seen_at,updated_at)
     values ($1::uuid,$2::uuid,$3::uuid,$4,$4,$4)
     on conflict (id) do update set
       language_channel_id=excluded.language_channel_id,
       last_seen_at=excluded.last_seen_at,
       updated_at=excluded.updated_at
     where audience_sessions.service_id=excluded.service_id`,
    [input.sessionId,input.serviceId,input.languageChannelId,now]
  );

  await client.query(
    `delete from audience_sessions
      where service_id=$1::uuid and id<>$2::uuid and last_seen_at < $3::timestamptz`,
    [input.serviceId,input.sessionId,new Date(now.getTime()-AUDIENCE_SESSION_RETENTION_MS)]
  );

  return { sessionId:input.sessionId,serviceId:input.serviceId,languageChannelId:input.languageChannelId,changed,lastSeenAt:now.toISOString() };
}
