import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { LIVE_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  state: z.enum(["detected", "preview", "live", "dismissed"])
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const { id } = await context.params;

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid scripture detection id" }, { status: 400 });
  }

  try {
    const { state } = bodySchema.parse(await request.json());
    const client = await db.connect();

    try {
      await client.query("begin");

      const target = await client.query<{
        id: string;
        service_id: string;
        scripture_reference: string;
        organization_id: string;
        state: string;
      }>(
        `select sd.id, sd.service_id, sd.scripture_reference, sd.state, s.organization_id
         from scripture_detections sd
         join services s on s.id = sd.service_id
         where sd.id = $1
         for update of sd`,
        [id]
      );

      if (!target.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Scripture detection not found" }, { status: 404 });
      }

      const row = target.rows[0];
      const allowed = await userHasAnyRole(session.user.id, row.organization_id, LIVE_OPERATOR_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to control live scripture output" }, { status: 403 });
      }

      if (state === "preview") {
        await client.query(
          "update scripture_detections set state='detected' where service_id=$1 and state='preview' and id<>$2",
          [row.service_id, id]
        );
      }

      if (state === "live") {
        await client.query(
          "update scripture_detections set state='played' where service_id=$1 and state='live' and id<>$2",
          [row.service_id, id]
        );
        await client.query(
          "update scripture_detections set state='detected' where service_id=$1 and state='preview' and id<>$2",
          [row.service_id, id]
        );
      }

      const updated = await client.query<{
        id: string;
        scripture_reference: string;
        state: string;
        detected_at: string;
      }>(
        "update scripture_detections set state=$2 where id=$1 returning id, scripture_reference, state, detected_at::text",
        [id, state]
      );

      await client.query(
        `insert into audit_events
          (organization_id, actor_type, action, entity_type, entity_id, details)
         values ($1, 'operator', $2, 'scripture_detection', $3, $4::jsonb)`,
        [
          row.organization_id,
          "scripture.state.changed",
          id,
          JSON.stringify({
            reference: row.scripture_reference,
            from: row.state,
            to: state
          })
        ]
      );

      await client.query("commit");
      await publishServiceEvent(row.service_id, "scripture.state.changed", {
        id,
        reference: row.scripture_reference,
        from: row.state,
        to: state
      });
      return NextResponse.json({ ok: true, scripture: updated.rows[0] });
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

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "State transition failed" },
      { status: 500 }
    );
  }
}
