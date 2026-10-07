import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { PLANNER_ITEM_TYPES } from "@/lib/planner-contracts";
import { PlannerItemError } from "@/lib/planner-item-schemas";
import { normalizePlannerItem } from "@/lib/planner-item-normalize";
import { PlannerServiceError, loadPlannerServiceDetail } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const previewSchema = z.object({
  itemType: z.enum(PLANNER_ITEM_TYPES),
  input: z.unknown()
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof PlannerItemError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid planner preview request", code: "planner_preview_invalid" }, { status: 400 });
  }
  console.error("Planner preview failed", error);
  return NextResponse.json({ ok: false, error: "Planner preview failed" }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const payload = previewSchema.parse(await request.json());
    const detail = await loadPlannerServiceDetail(client, session.userId, id);
    const normalized = await normalizePlannerItem(
      client,
      detail.service.organizationId,
      payload.itemType,
      payload.input,
      { defaultBibleVersion: detail.service.activeBibleVersion }
    );
    return NextResponse.json({
      ok: true,
      presentation: normalized.presentation,
      validation: { valid: true, issues: [] }
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    client.release();
  }
}
