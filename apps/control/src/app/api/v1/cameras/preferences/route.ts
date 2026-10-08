import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { CameraSourceError, clearCameraPreference, setCameraPreference } from "@/lib/camera-sources";

export const dynamic = "force-dynamic";

const preferenceSchema = z.object({
  organizationId: z.string().uuid(),
  mediaSourceId: z.string().uuid(),
  operatorLabel: z.string().trim().max(160).nullable().optional(),
  preferred: z.boolean().optional()
}).strict();

const clearSchema = z.object({
  organizationId: z.string().uuid(),
  mediaSourceId: z.string().uuid()
}).strict();

function failure(error: unknown) {
  if (error instanceof CameraSourceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid camera preference request", code: "camera_preference_invalid" }, { status: 400 });
  }
  console.error("Camera preference request failed", error);
  return NextResponse.json({ ok: false, error: "Camera preference request failed" }, { status: 500 });
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, response: NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 }) };
  if (session.user.forcePasswordChange) return { ok: false as const, response: NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 }) };
  return { ok: true as const, userId: session.user.id };
}

export async function PATCH(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;
  const client = await db.connect();
  try {
    const body = preferenceSchema.parse(await request.json());
    await client.query("begin");
    const preference = await setCameraPreference(client, session.userId, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, preference }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;
  const client = await db.connect();
  try {
    const body = clearSchema.parse(await request.json());
    await client.query("begin");
    const result = await clearCameraPreference(client, session.userId, body);
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return failure(error);
  } finally {
    client.release();
  }
}
