import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { PLANNER_ITEM_TYPES } from "@/lib/planner-contracts";
import { PlannerItemError } from "@/lib/planner-item-schemas";
import { deletePlannerItem, updatePlannerItem } from "@/lib/planner-mutations";
import { PlannerServiceError } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

const updateSchema = z.object({
  itemType: z.enum(PLANNER_ITEM_TYPES),
  input: z.unknown()
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
  console.error("Planner item mutation failed", error);
  return NextResponse.json({ ok: false, error: "Planner item mutation failed" }, { status: 500 });
}

function validateIds(id: string, itemId: string) {
  return z.string().uuid().safeParse(id).success && z.string().uuid().safeParse(itemId).success;
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;
  const { id, itemId } = await context.params;
  if (!validateIds(id, itemId)) {
    return NextResponse.json({ ok: false, error: "Invalid planner item id" }, { status: 400 });
  }
  const revision = revisionFrom(request);
  if (!revision) {
    return NextResponse.json({ ok: false, error: "Planner revision is required", code: "planner_revision_required" }, { status: 428 });
  }

  const client = await db.connect();
  try {
    const body = updateSchema.parse(await request.json());
    await client.query("begin");
    const result = await updatePlannerItem(client, session.userId, id, itemId, revision, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, { headers: { ETag: `"${result.revision}"` } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;
  const { id, itemId } = await context.params;
  if (!validateIds(id, itemId)) {
    return NextResponse.json({ ok: false, error: "Invalid planner item id" }, { status: 400 });
  }
  const revision = revisionFrom(request);
  if (!revision) {
    return NextResponse.json({ ok: false, error: "Planner revision is required", code: "planner_revision_required" }, { status: 428 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await deletePlannerItem(client, session.userId, id, itemId, revision);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, { headers: { ETag: `"${result.revision}"` } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
