import type { PoolClient } from "pg";
import { enqueueServiceEdgeCommand } from "./edge-command-dispatch.ts";

type ActiveStreamRow = {
  id: string;
  publisher_edge_device_id: string | null;
  status: "starting" | "live" | "stopping";
};

export type EndedServiceStreamResult = {
  endedSessionIds: string[];
  stopRequestedForDeviceId: string | null;
};

export async function finalizeStreamsForEndedService(
  client: PoolClient,
  input: { serviceId: string; organizationId: string; actorId: string }
): Promise<EndedServiceStreamResult> {
  const active = await client.query<ActiveStreamRow>(
    `select id::text,publisher_edge_device_id::text,status
     from stream_sessions
     where service_id=$1::uuid
       and status in ('starting','live','stopping')
     order by created_at desc,id desc
     for update`,
    [input.serviceId]
  );
  if (!active.rowCount) {
    return { endedSessionIds: [], stopRequestedForDeviceId: null };
  }

  const publisherEdgeDeviceId = active.rows.find((row) => row.publisher_edge_device_id)?.publisher_edge_device_id ?? null;
  let stopRequestedForDeviceId: string | null = null;
  if (publisherEdgeDeviceId) {
    const queued = await enqueueServiceEdgeCommand(client, {
      organizationId: input.organizationId,
      serviceId: input.serviceId,
      edgeDeviceId: publisherEdgeDeviceId,
      type: "stream.stop",
      issuedBy: input.actorId,
      source: "service-ended",
      ttlSeconds: 90
    });
    if (queued === 1) stopRequestedForDeviceId = publisherEdgeDeviceId;
  }

  const endedSessionIds = active.rows.map((row) => row.id);
  await client.query(
    `update stream_sessions
     set status='ended',
         ended_at=coalesce(ended_at,now()),
         error_code=null,
         metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
           'serviceEnd',jsonb_build_object(
             'forcedTerminalization',true,
             'stopRequested', $2::boolean,
             'publisherEdgeDeviceId',$3::text,
             'at',clock_timestamp()
           )
         ),
         updated_at=now()
     where id=any($1::uuid[])`,
    [endedSessionIds, Boolean(stopRequestedForDeviceId), publisherEdgeDeviceId]
  );

  await client.query(
    `update stream_session_destinations
     set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now()
     where stream_session_id=any($1::uuid[])
       and status not in ('ended','skipped','error')`,
    [endedSessionIds]
  );

  await client.query(
    `update edge_stream_contribution_sessions
     set revoked_at=coalesce(revoked_at,now()),updated_at=now()
     where service_id=$1::uuid
       and revoked_at is null`,
    [input.serviceId]
  );

  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1::uuid,'operator',$2,'stream.service_end.finalized','service',$3::text,$4::jsonb)`,
    [
      input.organizationId,
      input.actorId,
      input.serviceId,
      JSON.stringify({ endedSessionIds, stopRequestedForDeviceId })
    ]
  );

  return { endedSessionIds, stopRequestedForDeviceId };
}
