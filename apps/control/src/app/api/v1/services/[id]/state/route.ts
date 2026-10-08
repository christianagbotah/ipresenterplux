import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { validatePlannerReadiness } from "@/lib/planner-readiness";
import { LIVE_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";
import { finalizeStreamsForEndedService, type EndedServiceStreamResult } from "@/lib/service-stream-lifecycle";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  state: z.enum(["ready", "live", "ended"])
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }

  try {
    const { state } = bodySchema.parse(await request.json());
    const client = await db.connect();

    try {
      await client.query("begin");

      const scope = await client.query<{ id: string; organization_id: string; campus_id: string | null }>(
        "select id::text,organization_id::text,campus_id::text from services where id=$1",
        [id]
      );
      if (!scope.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }

      const allowed = await userHasAnyRole(session.user.id, scope.rows[0].organization_id, LIVE_OPERATOR_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to control this live service" }, { status: 403 });
      }

      const serviceScopeKey = `edge-service:${scope.rows[0].organization_id}:${scope.rows[0].campus_id ?? "none"}`;
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [serviceScopeKey]);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [scope.rows[0].id]);

      const current = await client.query<{
        id: string;
        organization_id: string;
        title: string;
        status: string;
      }>(
        "select id::text,organization_id::text,title,status from services where id=$1 for update",
        [id]
      );
      if (!current.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }
      const row = current.rows[0];

      if (state === "ready" && row.status !== "draft" && row.status !== "ready") {
        await client.query("rollback");
        return NextResponse.json(
          { ok: false, error: "Service cannot transition to ready from its current state", code: "service_transition_invalid" },
          { status: 409 }
        );
      }
      if (state === "live" && row.status !== "ready" && row.status !== "live") {
        await client.query("rollback");
        return NextResponse.json(
          { ok: false, error: "Service must be ready before it can go live", code: "service_transition_invalid" },
          { status: 409 }
        );
      }
      if (state === "ended" && row.status !== "live" && row.status !== "ended") {
        await client.query("rollback");
        return NextResponse.json(
          { ok: false, error: "Only a live service can be ended", code: "service_transition_invalid" },
          { status: 409 }
        );
      }

      if (state === "ready") {
        const readiness = await validatePlannerReadiness(client, id, row.organization_id);
        if (!readiness.ready) {
          await client.query("rollback");
          return NextResponse.json(
            {
              ok: false,
              error: "Service readiness checks failed",
              code: "readiness_failed",
              issues: readiness.issues
            },
            { status: 422 }
          );
        }
      }

      if (state === "live") {
        const conflict = await client.query<{ id: string; title: string }>(
          `select id::text,title
           from services
           where organization_id=$1
             and campus_id is not distinct from $2::uuid
             and status='live' and id<>$3
           limit 1`,
          [scope.rows[0].organization_id, scope.rows[0].campus_id, id]
        );
        if (conflict.rowCount) {
          await client.query("rollback");
          return NextResponse.json(
            { ok: false, error: `Another service is already live in this campus: ${conflict.rows[0].title}` },
            { status: 409 }
          );
        }
      }

      let streamFinalization: EndedServiceStreamResult | null = null;
      if (state === "ended") {
        streamFinalization = await finalizeStreamsForEndedService(client, {
          serviceId: id,
          organizationId: row.organization_id,
          actorId: session.user.id
        });
      }

      const updated = await client.query<{
        id: string;
        title: string;
        status: string;
        started_at: string | null;
        ended_at: string | null;
      }>(
        `update services
         set status=$2,
             started_at=case
               when $2='live' and started_at is null then now()
               when $2='ready' then null
               else started_at
             end,
             ended_at=case
               when $2='ended' then coalesce(ended_at,now())
               when $2 in ('ready','live') then null
               else ended_at
             end,
             updated_at=clock_timestamp()
         where id=$1
         returning id, title, status, started_at::text, ended_at::text`,
        [id, state]
      );

      let assignedEdgeDevices = 0;
      if (state === "live") {
        const assigned = await client.query(
          `update edge_devices
           set active_service_id=$1,updated_at=clock_timestamp()
           where organization_id=$2
             and campus_id is not distinct from $3::uuid
             and status='active'
             and active_service_id is distinct from $1`,
          [id, row.organization_id, scope.rows[0].campus_id]
        );
        assignedEdgeDevices = assigned.rowCount ?? 0;
      } else if (state === "ready") {
        const assigned = await client.query(
          `update edge_devices
           set active_service_id=$1,updated_at=clock_timestamp()
           where organization_id=$2
             and campus_id is not distinct from $3::uuid
             and status='active'
             and active_service_id is null`,
          [id, row.organization_id, scope.rows[0].campus_id]
        );
        assignedEdgeDevices = assigned.rowCount ?? 0;
      } else if (state === "ended") {
        const cleared = await client.query(
          `update edge_devices
           set active_service_id=null,updated_at=clock_timestamp()
           where organization_id=$2 and active_service_id=$1`,
          [id, row.organization_id]
        );
        assignedEdgeDevices = -(cleared.rowCount ?? 0);
      }

      if (state === "ended") {
        await client.query("delete from service_speaker_overrides where service_id=$1", [id]);
        await client.query(
          `update scripture_detections
           set state = case
             when state='live' then 'played'
             when state='preview' then 'detected'
             else state
           end
           where service_id=$1 and state in ('live','preview')`,
          [id]
        );
      }

      await client.query(
        `insert into audit_events
          (organization_id, actor_type, actor_id, action, entity_type, entity_id, details)
         values ($1, 'operator', $2, $3, 'service', $4, $5::jsonb)`,
        [
          row.organization_id,
          session.user.id,
          "service.state.changed",
          id,
          JSON.stringify({
            title: row.title,
            from: row.status,
            to: state,
            edgeDevicesAssigned: assignedEdgeDevices > 0 ? assignedEdgeDevices : 0,
            edgeDevicesCleared: assignedEdgeDevices < 0 ? -assignedEdgeDevices : 0
          })
        ]
      );

      await client.query("commit");
      await publishServiceEvent(id, "service.state.changed", {
        title: row.title,
        from: row.status,
        to: state
      });
      if (streamFinalization?.endedSessionIds.length) {
        await publishServiceEvent(id, "stream.session.changed", {
          status: "ended",
          streamSessionIds: streamFinalization.endedSessionIds,
          stopRequestedForDeviceId: streamFinalization.stopRequestedForDeviceId,
          reason: "service_ended"
        });
      }
      return NextResponse.json({
        ok: true,
        service: updated.rows[0],
        edgeDevicesAssigned: assignedEdgeDevices > 0 ? assignedEdgeDevices : 0,
        edgeDevicesCleared: assignedEdgeDevices < 0 ? -assignedEdgeDevices : 0
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid state", issues: error.issues }, { status: 400 });
    }
    console.error("Service transition failed", error);
    return NextResponse.json({ ok: false, error: "Service transition failed" }, { status: 500 });
  }
}
