import type { PoolClient } from "pg";

export type StreamSessionState = "idle" | "starting" | "live" | "stopping" | "ended" | "error";

type CommandResult = {
  serviceId: string;
  commandType: "stream.start" | "stream.stop";
  success: boolean;
  errorCode: string | null;
};

type TransitionResult = {
  sessionId: string;
  serviceId: string;
  status: StreamSessionState;
} | null;

export function streamPathForService(serviceId: string) {
  return `service/${serviceId}`;
}

export async function reconcileStreamCommandResult(
  client: PoolClient,
  result: CommandResult
): Promise<TransitionResult> {
  const session = await client.query<{
    id: string;
    service_id: string;
    status: StreamSessionState;
  }>(
    `select id::text,service_id::text,status
     from stream_sessions
     where service_id=$1::uuid
       and status in ('starting','live','stopping')
     order by created_at desc
     limit 1
     for update`,
    [result.serviceId]
  );
  const current = session.rows[0];
  if (!current) return null;

  const expectedStatus = result.commandType === "stream.start" ? "starting" : "stopping";
  if (current.status !== expectedStatus) return null;

  if (result.success) {
    await client.query(
      `update stream_sessions
       set metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
             'edgeCommand',jsonb_build_object(
               'type',$2::text,
               'state','succeeded',
               'at',clock_timestamp()
             )
           ),
           updated_at=now()
       where id=$1::uuid`,
      [current.id, result.commandType]
    );
    return current;
  }

  const fallbackCode = result.commandType === "stream.start" ? "edge_stream_start_failed" : "edge_stream_stop_failed";
  const errorCode = result.errorCode ?? fallbackCode;
  const updated = await client.query<{
    id: string;
    service_id: string;
    status: StreamSessionState;
  }>(
    `update stream_sessions
     set status='error',
         error_code=$2,
         ended_at=coalesce(ended_at,now()),
         metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
           'edgeCommand',jsonb_build_object(
             'type',$3::text,
             'state','failed',
             'errorCode',$2::text,
             'at',clock_timestamp()
           )
         ),
         updated_at=now()
     where id=$1::uuid
     returning id::text,service_id::text,status`,
    [current.id, errorCode, result.commandType]
  );

  await client.query(
    `update stream_session_destinations
     set status=case when status='pending' then 'skipped' else 'error' end,
         last_error_code=$2,
         ended_at=coalesce(ended_at,now()),
         updated_at=now()
     where stream_session_id=$1::uuid
       and status not in ('ended','skipped','error')`,
    [current.id, errorCode]
  );

  return updated.rows[0] ?? null;
}

export async function reconcileRouterReadyState(
  client: PoolClient,
  streamPath: string,
  ready: boolean
): Promise<TransitionResult> {
  const found = await client.query<{
    id: string;
    service_id: string;
    status: StreamSessionState;
  }>(
    `select ss.id::text,ss.service_id::text,ss.status
     from stream_sessions ss
     join services s on s.id=ss.service_id
     where ss.router_path=$1
       and ss.status in ('starting','live','stopping')
       and s.status in ('ready','live')
     order by ss.created_at desc
     limit 1
     for update of ss`,
    [streamPath]
  );
  const current = found.rows[0];
  if (!current) return null;

  if (ready) {
    if (current.status === "stopping") {
      await client.query(
        `update stream_sessions
         set router_last_seen_at=now(),updated_at=now()
         where id=$1::uuid`,
        [current.id]
      );
      return current;
    }

    const updated = await client.query<{
      id: string;
      service_id: string;
      status: StreamSessionState;
    }>(
      `update stream_sessions
       set status='live',
           started_at=coalesce(started_at,now()),
           router_ready_at=coalesce(router_ready_at,now()),
           router_last_seen_at=now(),
           router_not_ready_at=null,
           error_code=null,
           metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
             'router',jsonb_build_object('state','ready','path',$2::text,'at',clock_timestamp())
           ),
           updated_at=now()
       where id=$1::uuid
       returning id::text,service_id::text,status`,
      [current.id, streamPath]
    );

    await client.query(
      `update stream_session_destinations ssd
       set status='live',started_at=coalesce(ssd.started_at,now()),last_error_code=null,updated_at=now()
       from output_destinations od
       where ssd.stream_session_id=$1::uuid
         and od.id=ssd.output_destination_id
         and od.destination_type='web_webrtc'
         and od.enabled=true
         and ssd.status in ('pending','connecting','warning')`,
      [current.id]
    );

    return updated.rows[0] ?? null;
  }

  const expectedStop = current.status === "stopping";
  const nextStatus: StreamSessionState = expectedStop ? "ended" : "error";
  const errorCode = expectedStop ? null : "router_not_ready";
  const updated = await client.query<{
    id: string;
    service_id: string;
    status: StreamSessionState;
  }>(
    `update stream_sessions
     set status=$2,
         ended_at=coalesce(ended_at,now()),
         router_not_ready_at=now(),
         router_last_seen_at=now(),
         error_code=$3,
         metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
           'router',jsonb_build_object('state','not_ready','path',$4::text,'at',clock_timestamp())
         ),
         updated_at=now()
     where id=$1::uuid
     returning id::text,service_id::text,status`,
    [current.id, nextStatus, errorCode, streamPath]
  );

  if (expectedStop) {
    await client.query(
      `update stream_session_destinations
       set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now()
       where stream_session_id=$1::uuid
         and status not in ('ended','skipped')`,
      [current.id]
    );
  } else {
    await client.query(
      `update stream_session_destinations
       set status=case when status='pending' then 'skipped' else 'error' end,
           last_error_code=case when status='pending' then last_error_code else 'router_not_ready' end,
           ended_at=coalesce(ended_at,now()),
           updated_at=now()
       where stream_session_id=$1::uuid
         and status not in ('ended','skipped','error')`,
      [current.id]
    );
  }

  return updated.rows[0] ?? null;
}
