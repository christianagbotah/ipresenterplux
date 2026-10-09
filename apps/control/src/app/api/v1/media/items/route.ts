import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { MediaLibraryError, createMediaLibraryItem, listMediaLibrary } from "@/lib/media-library";
import { PlannerItemError } from "@/lib/planner-item-schemas";
import { PlannerServiceError } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  itemType: z.enum(["song", "slide", "media"]),
  input: z.unknown()
}).strict();

function failure(error: unknown) {
  if (error instanceof MediaLibraryError || error instanceof PlannerItemError || error instanceof PlannerServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid media library request", code: "media_library_invalid" }, { status: 400 });
  }
  console.error("Media library request failed", error);
  return NextResponse.json({ ok: false, error: "Media library request failed" }, { status: 500 });
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, response: NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 }) };
  if (session.user.forcePasswordChange) return { ok: false as const, response: NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 }) };
  return { ok: true as const, userId: session.user.id };
}

export async function GET(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") ?? "";
  if (!z.string().uuid().safeParse(organizationId).success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }
  const itemTypeValue = url.searchParams.get("itemType");
  const itemType = itemTypeValue && ["song", "slide", "media"].includes(itemTypeValue)
    ? itemTypeValue as "song" | "slide" | "media"
    : null;

  const client = await db.connect();
  try {
    const result = await listMediaLibrary(client, session.userId, {
      organizationId,
      search: url.searchParams.get("q"),
      itemType,
      limit: Number(url.searchParams.get("limit") ?? 50),
      offset: Number(url.searchParams.get("offset") ?? 0)
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  } finally {
    client.release();
  }
}

export async function POST(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;
  const client = await db.connect();
  try {
    const body = createSchema.parse(await request.json());
    await client.query("begin");
    const item = await createMediaLibraryItem(client, session.userId, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
