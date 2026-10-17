import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { CockpitSearchError, searchCockpit } from "@/lib/cockpit/search";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(8).optional()
}).strict();

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const client = await db.connect();
  try {
    const url = new URL(request.url);
    const parsed = searchSchema.parse({
      q: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit") ?? undefined
    });
    const search = await searchCockpit(client, session.user.id, {
      query: parsed.q,
      limitPerGroup: parsed.limit
    });
    return NextResponse.json({ ok: true, search });
  } catch (error) {
    if (error instanceof CockpitSearchError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid search query" }, { status: 400 });
    }
    console.error("Cockpit universal search failed", error);
    return NextResponse.json({ ok: false, error: "Search could not be completed" }, { status: 500 });
  } finally {
    client.release();
  }
}
