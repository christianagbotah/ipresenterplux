import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import {
  PlannerServiceError,
  createPlannerService,
  listPlannerServices
} from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  serviceType: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  campusId: z.string().uuid().nullable().optional(),
  scheduledStart: z.string().datetime({ offset: true }).nullable().optional(),
  activeBibleVersion: z.string().trim().min(1).max(32)
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid planner service request", issues: error.issues }, { status: 400 });
  }
  console.error("Planner service request failed", error);
  return NextResponse.json({ ok: false, error: "Planner service request failed" }, { status: 500 });
}

export async function GET(request: Request) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const client = await db.connect();
  try {
    const result = await listPlannerServices(client, session.userId, {
      filter: url.searchParams.get("filter"),
      organizationId: url.searchParams.get("organizationId"),
      campusId: url.searchParams.get("campusId"),
      limit: Number.isFinite(limit) ? limit : 25,
      offset: Number.isFinite(offset) ? offset : 0
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  } finally {
    client.release();
  }
}

export async function POST(request: Request) {
  const session = await requirePlannerSession();
  if (!session.ok) return session.response;

  const client = await db.connect();
  try {
    const input = createSchema.parse(await request.json());
    await client.query("begin");
    const result = await createPlannerService(client, session.userId, input);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, {
      status: 201,
      headers: { ETag: `"${result.revision}"` }
    });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return errorResponse(error);
  } finally {
    client.release();
  }
}
