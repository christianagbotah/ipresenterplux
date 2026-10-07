import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { PLANNER_ITEM_TYPES } from "@/lib/planner-contracts";
import { PlannerItemError } from "@/lib/planner-item-schemas";
import { createPlannerItem } from "@/lib/planner-mutations";
import { PlannerServiceError } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  itemType: z.enum(PLANNER_ITEM_TYPES),
  input: z.unknown(),
  position: z.number().int().min(0).max(199).optional()
}).strict();

function revisionFrom(request: Request) {
  const value = request.headers.get("if-match");
  return value?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;
}

function failure(error: unknown) {
  if (error instanceof PlannerServiceError || error instanceof PlannerItemError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid planner item request", code: "planner_item_invalid" }, { status: 400 });
  }
  console.error("Planner item create failed", error);
  return NextResponse.json({ ok: false, error: "Planner item create failed" }, { status: 500 });
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
    const result = await createPlannerItem(client, session.userId, id, revision, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, {
      status: 201,
      headers: { ETag: `"${result.revision}"` }
    });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
