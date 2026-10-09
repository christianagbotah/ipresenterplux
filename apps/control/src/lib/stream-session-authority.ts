import type { PoolClient } from "pg";

export type StreamSessionState = "idle" | "starting" | "live" | "stopping" | "ended" | "error";

type CommandResult = {
  serviceId: string;
  edgeDeviceId: string;
  commandType: "stream.start" | "stream.stop";
  success: boolean;
  errorCode: string | null;
};

type StreamSessionRow = {
  id: string;
  service_id: string;
  status: StreamSessionState;
};

type TransitionResult = {
  sessionId: string;
  serviceId: string;
  status: StreamSessionState;
} | null;

function toTransition(row: StreamSessionRow | undefined): TransitionResult {
  return row
    ? { sessionId: row.id, serviceId: row.service_id, status: row.status }
    : null;
}

export function streamPathForService(serviceId: string) {
  return `service/${serviceId}`;
}

export async function reconcileStreamCommandResult(
  client: PoolClient,
  result: CommandResult
): Promise<TransitionResult> {
  // Only the Edge chosen as publisher for this exact broadcast may reconcile its
  // stream.start/stream.stop commands into session state. A stale command from a
  // previously assigned device must not mutate the current broadcast.
  const session = await client.query<StreamSessionRow>(
    `select id::text,service_id::text,status
     from stream_sessions
     where service_id=$1::uuid
       and publisher_edge_device_id=$2::uuid
       and status in ('starting','live','stopping')
     order by created_at desc
     limit 1
     for update`,
    [result.serviceId, result.edgeDeviceId]
  );
  const current = session.rows[0];
  if (!current) return null;

  const expectedStatus = result.commandType === "stream.start" ? "starting" : "stopping";
  if (current.status !== expectedStatus) return null;

  if (result.success) {
    if (result.commandType === "stream.stop") {
      const updated = await client.query<StreamSessionRow>(
        `update stream_sessions
         set status='ended',
             ended_at=coalesce(ended_at,now()),
             error_code=null,
             metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
               'edgeCommand',jsonb_build_object(
                 'type',$2::text,
                 'state','succeeded',
                 'edgeDeviceId',$3::text,
                 'at',clock_timestamp()
               )
             ),
             updated_at=now()
         where id=$1::uuid
         returning id::text,service_id::text,status`,
        [current.id, result.commandType, result.edgeDeviceId]
      );

      await client.query(
        `update stream_session_destinations
         set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now()
         where stream_session_id=$1::uuid
           and status not in ('ended','skipped','error')`,
        [current.id]
      );

      await client.query(
        `update edge_stream_contribution_sessions
         set revoked_at=coalesce(revoked_at,now()),updated_at=now()
         where service_id=$1::uuid
           and revoked_at is null`,
        [result.serviceId]
      );

      return toTransition(updated.rows[0]);
    }

    await client.query(
      `update stream_sessions
       set metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
             'edgeCommand',jsonb_build_object(
               'type',$2::text,
               'state','succeeded',
               'edgeDeviceId',$3::text,
               'at',clock_timestamp()
             )
           ),
           updated_at=now()
       where id=$1::uuid`,
      [current.id, result.commandType, result.edgeDeviceId]
    );
    return toTransition(current);
  }

  const fallbackCode = result.commandType === "stream.start" ? "edge_stream_start_failed" : "edge_stream_stop_failed";
  const errorCode = result.errorCode ?? fallbackCode;
  const updated = await client.query<StreamSessionRow>(
    `update stream_sessions
     set status='error',
         error_code=$2,
         ended_at=coalesce(ended_at,now()),
         metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
           'edgeCommand',jsonb_build_object(
             'type',$3::text,
             'state','failed',
             'edgeDeviceId',$4::text,
             'errorCode',$2::text,
             'at',clock_timestamp()
           )
         ),
         updated_at=now()
     where id=$1::uuid
     returning id::text,service_id::text,status`,
    [current.id, errorCode, result.commandType, result.edgeDeviceId]
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

  await client.query(
    `update edge_stream_contribution_sessions
     set revoked_at=coalesce(revoked_at,now()),updated_at=now()
     where service_id=$1::uuid
       and revoked_at is null`,
    [result.serviceId]
  );

  return toTransition(updated.rows[0]);
}

export async function reconcileStaleStreamSession(
  client: PoolClient,
  serviceId: string,
  options: { startingTimeoutSeconds?: number; stoppingTimeoutSeconds?: number } = {}
): Promise<TransitionResult> {
  const startingTimeoutSeconds = Number.isInteger(options.startingTimeoutSeconds) && (options.startingTimeoutSeconds ?? 0) > 0
    ? options.startingTimeoutSeconds!
    : 120;
  const stoppingTimeoutSeconds = Number.isInteger(options.stoppingTimeoutSeconds) && (options.stoppingTimeoutSeconds ?? 0) > 0
    ? options.stoppingTimeoutSeconds!
    : 120;

  const found = await client.query<StreamSessionRow>(
    `select id::text,service_id::text,status
     from stream_sessions
     where service_id=$1::uuid
       and (
         (status='starting' and updated_at <= clock_timestamp() - ($2::int * interval '1 second'))
         or
         (status='stopping' and updated_at <= clock_timestamp() - ($3::int * interval '1 second'))
       )
     order by created_at desc
     limit 1
     for update`,
    [serviceId, startingTimeoutSeconds, stoppingTimeoutSeconds]
  );
  const current = found.rows[0];
  if (!current) return null;

  const staleStart = current.status === "starting";
  const nextStatus: StreamSessionState = staleStart ? "error" : "ended";
  const errorCode = staleStart ? "stream_start_timeout" : null;
  const reason = staleStart ? "stale_start_timeout" : "stale_stop_finalized";
  const timeoutSeconds = staleStart ? startingTimeoutSeconds : stoppingTimeoutSeconds;

  const updated = await client.query<StreamSessionRow>(
    `update stream_sessions
     set status=$2,
         ended_at=coalesce(ended_at,now()),
         error_code=$3,
         metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
           'reconciliation',jsonb_build_object(
             'reason',$4::text,
             'timeoutSeconds',$5::int,
             'at',clock_timestamp()
           )
         ),
         updated_at=now()
     where id=$1::uuid
     returning id::text,service_id::text,status`,
    [current.id, nextStatus, errorCode, reason, timeoutSeconds]
  );

  if (staleStart) {
    await client.query(
      `update stream_session_destinations
       set status=case when status='pending' then 'skipped' else 'error' end,
           last_error_code=case when status='pending' then last_error_code else 'stream_start_timeout' end,
           ended_at=coalesce(ended_at,now()),
           updated_at=now()
       where stream_session_id=$1::uuid
         and status not in ('ended','skipped','error')`,
      [current.id]
    );
  } else {
    await client.query(
      `update stream_session_destinations
       set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now()
       where stream_session_id=$1::uuid
         and status not in ('ended','skipped','error')`,
      [current.id]
    );
  }

  await client.query(
    `update edge_stream_contribution_sessions
     set revoked_at=coalesce(revoked_at,now()),updated_at=now()
     where service_id=$1::uuid
       and revoked_at is null`,
    [serviceId]
  );

  return toTransition(updated.rows[0]);
}

export async function reconcileRouterReadyState(
  client: PoolClient,
  streamPath: string,
  ready: boolean
): Promise<TransitionResult> {
  const found = await client.query<StreamSessionRow>(
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
      return toTransition(current);
    }

    const updated = await client.query<StreamSessionRow>(
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

    return toTransition(updated.rows[0]);
  }

  const expectedStop = current.status === "stopping";
  const nextStatus: StreamSessionState = expectedStop ? "ended" : "error";
  const errorCode = expectedStop ? null : "router_not_ready";
  const updated = await client.query<StreamSessionRow>(
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

  return toTransition(updated.rows[0]);
}
