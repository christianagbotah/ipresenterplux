import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { MediaLibraryError, addMediaItemToServiceRundown } from "@/lib/media-library";
import { PlannerItemError } from "@/lib/planner-item-schemas";
import { PlannerServiceError } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const addSchema = z.object({
  serviceId: z.string().uuid(),
  expectedRevision: z.string().min(16).max(200),
  position: z.number().int().min(0).max(199).optional()
}).strict();

function failure(error: unknown) {
  if (error instanceof MediaLibraryError || error instanceof PlannerItemError || error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid add-to-service request", code: "media_library_invalid" }, { status: 400 });
  }
  console.error("Media library add-to-service failed", error);
  return NextResponse.json({ ok: false, error: "Could not add media item to service" }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid media library item id" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const body = addSchema.parse(await request.json());
    await client.query("begin");
    const result = await addMediaItemToServiceRundown(client, session.user.id, {
      libraryItemId: id,
      ...body
    });
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, {
      status: 201,
      headers: { ETag: `"${result.revision}"`, "Cache-Control": "no-store" }
    });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
