import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import {
  PlannerServiceError,
  loadPlannerServiceDetail,
  updatePlannerServiceMetadata
} from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  serviceType: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  campusId: z.string().uuid().nullable().optional(),
  scheduledStart: z.string().datetime({ offset: true }).nullable().optional(),
  activeBibleVersion: z.string().trim().min(1).max(32).optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

function errorResponse(error: unknown) {
  if (error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid planner service request", issues: error.issues }, { status: 400 });
  }
  console.error("Planner service detail request failed", error);
  return NextResponse.json({ ok: false, error: "Planner service request failed" }, { status: 500 });
}

function parseRevision(value: string | null) {
  if (!value) return null;
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const result = await loadPlannerServiceDetail(client, session.userId, id);
    return NextResponse.json({ ok: true, ...result }, { headers: { ETag: `"${result.revision}"` } });
  } catch (error) {
    return errorResponse(error);
  } finally {
    client.release();
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }
  const expectedRevision = parseRevision(request.headers.get("if-match"));
  if (!expectedRevision) {
    return NextResponse.json(
      { ok: false, error: "Planner revision is required", code: "planner_revision_required" },
      { status: 428 }
    );
  }

  const client = await db.connect();
  try {
    const input = updateSchema.parse(await request.json());
    await client.query("begin");
    const result = await updatePlannerServiceMetadata(client, session.userId, id, expectedRevision, input);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, { headers: { ETag: `"${result.revision}"` } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return errorResponse(error);
  } finally {
    client.release();
  }
}
