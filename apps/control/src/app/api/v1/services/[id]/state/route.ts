import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  state: z.enum(["ready", "live", "ended"])
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }

  try {
    const { state } = bodySchema.parse(await request.json());
    const client = await db.connect();

    try {
      await client.query("begin");

      const current = await client.query<{
        id: string;
        organization_id: string;
        title: string;
        status: string;
      }>(
        "select id, organization_id, title, status from services where id=$1 for update",
        [id]
      );

      if (!current.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }

      const row = current.rows[0];

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
               when $2='ended' then now()
               when $2 in ('ready','live') then null
               else ended_at
             end,
             updated_at=now()
         where id=$1
         returning id, title, status, started_at::text, ended_at::text`,
        [id, state]
      );

      if (state === "ended") {
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
          (organization_id, actor_type, action, entity_type, entity_id, details)
         values ($1, 'operator', $2, 'service', $3, $4::jsonb)`,
        [
          row.organization_id,
          "service.state.changed",
          id,
          JSON.stringify({ title: row.title, from: row.status, to: state })
        ]
      );

      await client.query("commit");
      return NextResponse.json({ ok: true, service: updated.rows[0] });
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
      { ok: false, error: error instanceof Error ? error.message : "Service transition failed" },
      { status: 500 }
    );
  }
}
