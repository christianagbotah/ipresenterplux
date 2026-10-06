import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { enqueueServiceEdgeCommand } from "@/lib/edge-command-dispatch";
import { STREAM_OPERATOR_ROLES } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";
import { streamPathForService, type StreamSessionState } from "@/lib/stream-session-authority";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.enum(["start", "stop"]),
  videoProfile: z.string().trim().min(1).max(40).optional()
});

type ServiceRow = {
  id: string;
  organization_id: string;
  status: string;
};

type SessionRow = {
  id: string;
  status: StreamSessionState;
  video_profile: string;
  router_path: string | null;
  started_at: string | null;
  ended_at: string | null;
  error_code: string | null;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const { id: serviceId } = await context.params;
  if (!z.string().uuid().safeParse(serviceId).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }

  try {
    const payload = bodySchema.parse(await request.json());
    const client = await db.connect();
    let realtime: { event: string; payload: Record<string, unknown> } | null = null;

    try {
      await client.query("begin");

      const serviceResult = await client.query<ServiceRow>(
        `select id::text,organization_id::text,status
         from services
         where id=$1::uuid
         for update`,
        [serviceId]
      );
      const service = serviceResult.rows[0];
      if (!service) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }

      const role = await client.query<{ allowed: boolean }>(
        `select exists(
           select 1 from user_organization_roles
           where user_id=$1
             and organization_id=$2::uuid
             and role_id=any($3::text[])
         ) as allowed`,
        [session.user.id, service.organization_id, [...STREAM_OPERATOR_ROLES]]
      );
      if (!role.rows[0]?.allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to control streaming" }, { status: 403 });
      }

      const activeResult = await client.query<SessionRow>(
        `select id::text,status,video_profile,router_path,started_at::text,ended_at::text,error_code
         from stream_sessions
         where service_id=$1::uuid
           and status in ('starting','live','stopping')
         order by created_at desc
         limit 1
         for update`,
        [serviceId]
      );
      const active = activeResult.rows[0];

      if (payload.action === "start") {
        if (active?.status === "starting" || active?.status === "live") {
          await client.query("commit");
          return NextResponse.json({ ok: true, duplicate: true, streamSession: active });
        }
        if (active?.status === "stopping") {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "The current broadcast is still stopping" }, { status: 409 });
        }
        if (!['ready', 'live'].includes(service.status)) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Service is not ready for streaming" }, { status: 409 });
        }

        const edge = await client.query<{ count: string }>(
          `select count(*)::text as count
           from edge_devices
           where organization_id=$1::uuid
             and active_service_id=$2::uuid
             and status='active'`,
          [service.organization_id, serviceId]
        );
        if (Number(edge.rows[0]?.count ?? 0) < 1) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "No active Edge device is assigned to this service" }, { status: 409 });
        }

        const destinations = await client.query<{ count: string }>(
          `select count(*)::text as count
           from output_destinations
           where organization_id=$1::uuid
             and enabled=true
             and destination_type <> 'ndi'`,
          [service.organization_id]
        );
        if (Number(destinations.rows[0]?.count ?? 0) < 1) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Enable at least one broadcast destination before starting" }, { status: 409 });
        }

        const routerPath = streamPathForService(serviceId);
        const inserted = await client.query<SessionRow>(
          `insert into stream_sessions
             (service_id,status,video_profile,router_path,metrics,updated_at)
           values ($1::uuid,'starting',$2,$3,jsonb_build_object('requestedAt',clock_timestamp()),now())
           returning id::text,status,video_profile,router_path,started_at::text,ended_at::text,error_code`,
          [serviceId, payload.videoProfile ?? "1080p30", routerPath]
        );
        const streamSession = inserted.rows[0];

        await client.query(
          `insert into stream_session_destinations
             (stream_session_id,output_destination_id,status)
           select $1::uuid,od.id,'pending'
           from output_destinations od
           where od.organization_id=$2::uuid
             and od.enabled=true
             and od.destination_type <> 'ndi'
           on conflict (stream_session_id,output_destination_id) do nothing`,
          [streamSession.id, service.organization_id]
        );

        const queued = await enqueueServiceEdgeCommand(client, {
          organizationId: service.organization_id,
          serviceId,
          type: "stream.start",
          issuedBy: session.user.id,
          source: "streaming-studio",
          ttlSeconds: 90
        });
        if (queued < 1) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "No assigned Edge device accepted the start command" }, { status: 409 });
        }

        await client.query(
          `insert into audit_events
             (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
           values ($1::uuid,'operator',$2,'stream.start.requested','stream_session',$3,$4::jsonb)`,
          [service.organization_id, session.user.id, streamSession.id, JSON.stringify({ serviceId, routerPath, queuedEdgeDevices: queued, videoProfile: streamSession.video_profile })]
        );

        realtime = {
          event: "stream.session.changed",
          payload: { streamSessionId: streamSession.id, status: "starting", routerPath, queuedEdgeDevices: queued }
        };
        await client.query("commit");
        await publishServiceEvent(serviceId, realtime.event, realtime.payload);
        return NextResponse.json({ ok: true, duplicate: false, streamSession, queuedEdgeDevices: queued }, { status: 202 });
      }

      if (!active) {
        await client.query("commit");
        return NextResponse.json({ ok: true, duplicate: true, streamSession: null, status: "idle" });
      }
      if (active.status === "stopping") {
        await client.query("commit");
        return NextResponse.json({ ok: true, duplicate: true, streamSession: active });
      }

      const edge = await client.query<{ count: string }>(
        `select count(*)::text as count
         from edge_devices
         where organization_id=$1::uuid
           and active_service_id=$2::uuid
           and status='active'`,
        [service.organization_id, serviceId]
      );
      if (Number(edge.rows[0]?.count ?? 0) < 1) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Assigned Edge device is unavailable; broadcast stop cannot be confirmed safely" }, { status: 409 });
      }

      const stopping = await client.query<SessionRow>(
        `update stream_sessions
         set status='stopping',error_code=null,updated_at=now()
         where id=$1::uuid
         returning id::text,status,video_profile,router_path,started_at::text,ended_at::text,error_code`,
        [active.id]
      );

      await client.query(
        `update edge_stream_contribution_sessions
         set revoked_at=coalesce(revoked_at,now()),updated_at=now()
         where service_id=$1::uuid
           and revoked_at is null`,
        [serviceId]
      );

      const queued = await enqueueServiceEdgeCommand(client, {
        organizationId: service.organization_id,
        serviceId,
        type: "stream.stop",
        issuedBy: session.user.id,
        source: "streaming-studio",
        ttlSeconds: 90
      });
      if (queued < 1) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "No assigned Edge device accepted the stop command" }, { status: 409 });
      }

      await client.query(
        `insert into audit_events
           (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1::uuid,'operator',$2,'stream.stop.requested','stream_session',$3,$4::jsonb)`,
        [service.organization_id, session.user.id, active.id, JSON.stringify({ serviceId, queuedEdgeDevices: queued })]
      );

      const streamSession = stopping.rows[0];
      realtime = {
        event: "stream.session.changed",
        payload: { streamSessionId: streamSession.id, status: "stopping", queuedEdgeDevices: queued }
      };
      await client.query("commit");
      await publishServiceEvent(serviceId, realtime.event, realtime.payload);
      return NextResponse.json({ ok: true, duplicate: false, streamSession, queuedEdgeDevices: queued }, { status: 202 });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid stream action", issues: error.issues }, { status: 400 });
    }
    console.error("Stream session action failed", error);
    return NextResponse.json({ ok: false, error: "Stream session action failed" }, { status: 500 });
  }
}
