import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import {
  ScriptureAutomationSettingsError,
  setServiceScriptureAutomation
} from "@/lib/scripture-automation-settings";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  mode: z.enum(["manual", "auto_preview", "auto_live"]),
  armed: z.boolean(),
  referenceThreshold: z.number().max(100).optional(),
  quoteThreshold: z.number().max(100).optional()
}).strict();

function failure(error: unknown) {
  if (error instanceof ScriptureAutomationSettingsError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid service Scripture automation settings", code: "scripture_automation_service_settings_invalid", issues: error.issues }, { status: 400 });
  }
  console.error("Service Scripture automation update failed", error);
  return NextResponse.json({ ok: false, error: "Scripture automation settings update failed" }, { status: 500 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid service id", code: "service_id_invalid" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const body = bodySchema.parse(await request.json());
    await client.query("begin");
    const settings = await setServiceScriptureAutomation(client, session.user.id, id, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
