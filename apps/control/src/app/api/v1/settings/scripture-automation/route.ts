import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import {
  ScriptureAutomationSettingsError,
  setOrganizationScriptureAutomationPermission
} from "@/lib/scripture-automation-settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ autoScriptureLiveEnabled: z.boolean() }).strict();

function failure(error: unknown) {
  if (error instanceof ScriptureAutomationSettingsError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid Scripture automation settings", code: "scripture_automation_settings_invalid", issues: error.issues }, { status: 400 });
  }
  console.error("Organization Scripture automation update failed", error);
  return NextResponse.json({ ok: false, error: "Scripture automation settings update failed" }, { status: 500 });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
    return NextResponse.json({ ok: false, error: "Valid organizationId query parameter required", code: "organization_id_required" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const body = bodySchema.parse(await request.json());
    await client.query("begin");
    const settings = await setOrganizationScriptureAutomationPermission(
      client,
      session.user.id,
      organizationId,
      body.autoScriptureLiveEnabled
    );
    await client.query("commit");
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
