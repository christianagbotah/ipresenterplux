import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { AIDirectorError, updateAIDirectorSettings } from "@/lib/ai-director";

export const dynamic = "force-dynamic";

const schema = z.object({
  organizationId: z.string().uuid(),
  serviceId: z.string().uuid(),
  aiEnabled: z.boolean(),
  autoPreviewThreshold: z.number().min(0).max(100)
}).strict();

function failure(error: unknown) {
  if (error instanceof AIDirectorError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid AI Director settings", code: "ai_director_settings_invalid" }, { status: 400 });
  }
  console.error("AI Director settings update failed", error);
  return NextResponse.json({ ok: false, error: "AI Director settings update failed" }, { status: 500 });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const client = await db.connect();
  try {
    const body = schema.parse(await request.json());
    await client.query("begin");
    const settings = await updateAIDirectorSettings(client, session.user.id, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
