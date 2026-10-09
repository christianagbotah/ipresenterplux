import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { createManualScriptureDetection, ManualScriptureError } from "@/lib/manual-scripture";
import { LIVE_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  serviceId: z.string().uuid(),
  reference: z.string().trim().min(3).max(120),
  version: z.string().trim().min(1).max(32)
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  try {
    const payload = bodySchema.parse(await request.json());
    const client = await db.connect();

    try {
      await client.query("begin");

      const scope = await client.query<{ organization_id: string }>(
        `select organization_id::text
         from services
         where id=$1::uuid
         limit 1`,
        [payload.serviceId]
      );
      if (!scope.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }

      const allowed = await userHasAnyRole(session.user.id, scope.rows[0].organization_id, LIVE_OPERATOR_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to control live scripture output" }, { status: 403 });
      }

      const scripture = await createManualScriptureDetection(client, {
        serviceId: payload.serviceId,
        reference: payload.reference,
        version: payload.version,
        actorId: session.user.id
      });

      await client.query("commit");
      await publishServiceEvent(payload.serviceId, "scripture.detected", {
        id: scripture.id,
        reference: scripture.reference,
        state: scripture.state,
        detectionMethod: "manual",
        reused: scripture.reused
      });

      return NextResponse.json({ ok: true, scripture }, { status: scripture.reused ? 200 : 201 });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid manual scripture request", issues: error.issues }, { status: 400 });
    }
    if (error instanceof ManualScriptureError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Manual scripture selection failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false, error: "Manual scripture selection failed" }, { status: 500 });
  }
}
