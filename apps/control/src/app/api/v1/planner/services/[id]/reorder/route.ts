import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { PLANNER_MAX_ITEMS } from "@/lib/planner-contracts";
import { reorderPlannerItems } from "@/lib/planner-mutations";
import { PlannerServiceError } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  itemIds: z.array(z.string().uuid()).max(PLANNER_MAX_ITEMS)
}).strict();

function revisionFrom(request: Request) {
  const value = request.headers.get("if-match");
  return value?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;
}

function failure(error: unknown) {
  if (error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid planner reorder request", code: "planner_reorder_invalid" }, { status: 400 });
  }
  console.error("Planner reorder failed", error);
  return NextResponse.json({ ok: false, error: "Planner reorder failed" }, { status: 500 });
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
    const body = bodySchema.parse(await request.json());
    await client.query("begin");
    const result = await reorderPlannerItems(client, session.userId, id, revision, body.itemIds);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, { headers: { ETag: `"${result.revision}"` } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
