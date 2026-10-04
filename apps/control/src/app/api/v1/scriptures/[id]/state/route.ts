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
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
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

      const scope = await client.query<{ service_id: string; organization_id: string }>(
        `select sd.service_id::text,s.organization_id::text
         from scripture_detections sd
         join services s on s.id=sd.service_id
         where sd.id=$1`,
        [id]
      );
      if (!scope.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Scripture detection not found" }, { status: 404 });
      }

      const allowed = await userHasAnyRole(session.user.id, scope.rows[0].organization_id, LIVE_OPERATOR_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to control live scripture output" }, { status: 403 });
      }

      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [scope.rows[0].service_id]);

      const target = await client.query<{
        id: string;
        service_id: string;
        scripture_reference: string;
        organization_id: string;
        state: string;
        book: string;
        chapter: number;
        verse_start: number | null;
        verse_end: number | null;
        bible_version: string;
      }>(
        `select sd.id::text,sd.service_id::text,sd.scripture_reference,sd.state,s.organization_id::text,
                sd.book,sd.chapter,sd.verse_start,sd.verse_end,sd.bible_version
         from scripture_detections sd
         join services s on s.id=sd.service_id
         where sd.id=$1 and sd.service_id=$2
         for update of sd`,
        [id, scope.rows[0].service_id]
      );
      if (!target.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Scripture detection not found" }, { status: 404 });
      }
      const row = target.rows[0];

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

      const hasValidContextRange = Number.isInteger(row.chapter) && row.chapter > 0
        && row.verse_start !== null && Number.isInteger(row.verse_start) && row.verse_start > 0
        && (row.verse_end === null || (Number.isInteger(row.verse_end) && row.verse_end >= row.verse_start));

      if ((state === "preview" || state === "live") && hasValidContextRange) {
        await client.query(
          `insert into service_scripture_context
            (service_id,book,chapter,verse_start,verse_end,bible_version,source_observed_at,source_ordinal,updated_at)
           values ($1,$2,$3,$4,$5,$6,now(),0,now())
           on conflict (service_id) do update set
             book=excluded.book,chapter=excluded.chapter,verse_start=excluded.verse_start,verse_end=excluded.verse_end,
             bible_version=excluded.bible_version,source_observed_at=excluded.source_observed_at,
             source_ordinal=0,updated_at=now()`,
          [row.service_id,row.book,row.chapter,row.verse_start,row.verse_end,row.bible_version]
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
          (organization_id, actor_type, actor_id, action, entity_type, entity_id, details)
         values ($1, 'operator', $2, $3, 'scripture_detection', $4, $5::jsonb)`,
        [
          row.organization_id,
          session.user.id,
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
    console.error("Scripture state transition failed", error);
    return NextResponse.json({ ok: false, error: "State transition failed" }, { status: 500 });
  }
}
