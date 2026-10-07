import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { returnPlannerServiceToDraft } from "@/lib/planner-readiness";
import { PlannerServiceError } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function revisionFrom(request: Request) {
  const value = request.headers.get("if-match");
  return value?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;
}

function failure(error: unknown) {
  if (error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  console.error("Planner draft transition failed", error);
  return NextResponse.json({ ok: false, error: "Planner draft transition failed" }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }
  const revision = revisionFrom(request);
  if (!revision) {
    return NextResponse.json({ ok: false, error: "Planner revision is required", code: "planner_revision_required" }, { status: 428 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await returnPlannerServiceToDraft(client, session.userId, id, revision);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, { headers: { ETag: `"${result.revision}"` } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
