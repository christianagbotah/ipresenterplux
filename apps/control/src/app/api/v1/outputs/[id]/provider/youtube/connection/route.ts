import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { STREAM_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid output id" }, { status: 400 });

  const client = await db.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ organization_id: string; name: string; destination_type: string }>(
      `select organization_id::text,name,destination_type from output_destinations where id=$1::uuid for update`,
      [id]
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Output destination not found" }, { status: 404 });
    }
    if (row.destination_type !== "youtube") {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "This destination does not use a YouTube provider connection" }, { status: 409 });
    }
    if (!(await userHasAnyRole(session.user.id, row.organization_id, STREAM_OPERATOR_ROLES))) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "You are not allowed to manage broadcast providers" }, { status: 403 });
    }
    const active = await client.query<{ active: boolean }>(
      `select exists(
         select 1 from stream_sessions ss join services s on s.id=ss.service_id
         where s.organization_id=$1::uuid and ss.status in ('starting','live','stopping')
       ) as active`,
      [row.organization_id]
    );
    if (active.rows[0]?.active) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Provider connections are locked during an active broadcast" }, { status: 409 });
    }

    await client.query("delete from output_destination_provider_accounts where output_destination_id=$1::uuid and provider='youtube'", [id]);
    await client.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1::uuid,'operator',$2,'output.provider.disconnected','output_destination',$3,$4::jsonb)`,
      [row.organization_id, session.user.id, id, JSON.stringify({ name: row.name, provider: "youtube" })]
    );
    await client.query("commit");
    return NextResponse.json({ ok: true, connected: false }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("rollback");
    return NextResponse.json({ ok: false, error: "YouTube provider connection could not be removed" }, { status: 500 });
  } finally {
    client.release();
  }
}
