import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { publishServiceEvent } from "@/lib/realtime";
import { reconcileRouterReadyState } from "@/lib/stream-session-authority";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  path: z.string().trim().regex(/^service\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ready: z.enum(["0", "1"])
});

function callbackAuthorized(request: Request) {
  const expected = process.env.IPRESENTERPLUX_MEDIA_CALLBACK_TOKEN?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!process.env.IPRESENTERPLUX_MEDIA_CALLBACK_TOKEN?.trim()) {
    return NextResponse.json({ ok: false, error: "Media callback is not configured" }, { status: 503 });
  }
  if (!callbackAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Media callback authentication required" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      path: url.searchParams.get("path"),
      ready: url.searchParams.get("ready")
    });
    const ready = input.ready === "1";
    const serviceId = input.path.slice("service/".length);
    const client = await db.connect();

    try {
      await client.query("begin");

      const evidence = await client.query<{ organization_id: string }>(
        ready
          ? `select ecs.organization_id::text
             from edge_stream_contribution_sessions ecs
             join services s on s.id=ecs.service_id and s.organization_id=ecs.organization_id
             join edge_devices d on d.id=ecs.edge_device_id and d.organization_id=ecs.organization_id
             where ecs.service_id=$1::uuid
               and ecs.stream_path=$2
               and ecs.revoked_at is null
               and ecs.expires_at > now()
               and ecs.last_seen_at > now()-interval '2 minutes'
               and d.status='active'
               and s.status in ('ready','live')
             order by ecs.last_seen_at desc
             limit 1`
          : `select ecs.organization_id::text
             from edge_stream_contribution_sessions ecs
             join services s on s.id=ecs.service_id and s.organization_id=ecs.organization_id
             where ecs.service_id=$1::uuid
               and ecs.stream_path=$2
               and ecs.last_seen_at is not null
               and ecs.issued_at > now()-interval '30 minutes'
               and s.status in ('ready','live')
             order by ecs.last_seen_at desc
             limit 1`,
        [serviceId, input.path]
      );
      const organizationId = evidence.rows[0]?.organization_id;
      if (!organizationId) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "No recent contribution evidence matches this router path" }, { status: 409 });
      }

      const transition = await reconcileRouterReadyState(client, input.path, ready);
      if (!transition) {
        await client.query("commit");
        return NextResponse.json({ ok: true, ignored: true });
      }

      await client.query(
        `insert into audit_events
           (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1::uuid,'system','media_router',$2,'stream_session',$3,$4::jsonb)`,
        [
          organizationId,
          ready ? "stream.router.ready" : "stream.router.not_ready",
          transition.sessionId,
          JSON.stringify({ serviceId: transition.serviceId, path: input.path, status: transition.status })
        ]
      );

      await client.query("commit");
      await publishServiceEvent(transition.serviceId, "stream.session.changed", {
        streamSessionId: transition.sessionId,
        status: transition.status,
        routerReady: ready
      });

      return NextResponse.json({ ok: true, ignored: false, streamSession: transition });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid router state callback", issues: error.issues }, { status: 400 });
    }
    console.error("Router state callback failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false, error: "Router state callback failed" }, { status: 500 });
  }
}
