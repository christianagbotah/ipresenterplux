import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { STREAM_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";

const bodySchema = z.object({
  enabled: z.boolean()
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
    return NextResponse.json({ ok: false, error: "Invalid output id" }, { status: 400 });
  }

  try {
    const { enabled } = bodySchema.parse(await request.json());
    const client = await db.connect();

    try {
      await client.query("begin");

      const target = await client.query<{
        id: string;
        organization_id: string;
        name: string;
        enabled: boolean;
      }>(
        "select id, organization_id::text, name, enabled from output_destinations where id=$1 for update",
        [id]
      );

      if (!target.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Output destination not found" }, { status: 404 });
      }

      const row = target.rows[0];
      const allowed = await userHasAnyRole(session.user.id, row.organization_id, STREAM_OPERATOR_ROLES);

      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to manage broadcast outputs" }, { status: 403 });
      }

      const updated = await client.query<{
        id: string;
        name: string;
        enabled: boolean;
        status: string;
      }>(
        `update output_destinations
         set enabled=$2,
             status=case when $2 then 'ready' else 'disconnected' end,
             updated_at=now()
         where id=$1
         returning id,name,enabled,status`,
        [id, enabled]
      );

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'output.state.changed','output_destination',$3,$4::jsonb)`,
        [
          row.organization_id,
          session.user.id,
          id,
          JSON.stringify({ name: row.name, from: row.enabled, to: enabled })
        ]
      );

      const activeService = await client.query<{ id: string }>(
        "select id from services where organization_id=$1 and status in ('live','ready') order by case when status='live' then 0 else 1 end, created_at desc limit 1",
        [row.organization_id]
      );

      await client.query("commit");

      if (activeService.rows[0]) {
        await publishServiceEvent(activeService.rows[0].id, "output.state.changed", {
          id,
          name: row.name,
          enabled
        });
      }

      return NextResponse.json({ ok: true, output: updated.rows[0] });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid output state", issues: error.issues }, { status: 400 });
    }
    console.error("Output update failed", error);
    return NextResponse.json({ ok: false, error: "Output update failed" }, { status: 500 });
  }
}
