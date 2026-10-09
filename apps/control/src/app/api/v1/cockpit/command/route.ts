import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import {
  CockpitCommandError,
  executeCockpitIntent,
  resolveCockpitCommand
} from "@/lib/cockpit/commands";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(400)
}).strict();

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const client = await db.connect();
  try {
    const { text } = requestSchema.parse(await request.json());
    const context = await getCurrentServiceForUser(session.user.id, { client });
    if (!context) {
      return NextResponse.json({ ok: false, error: "Church workspace was not found" }, { status: 404 });
    }

    const resolution = resolveCockpitCommand(text, {
      organizationId: context.organizationId,
      serviceId: context.service?.id ?? null,
      defaultBibleVersion: context.service?.activeBibleVersion ?? "WEBP"
    });
    if (resolution.status !== "ready") {
      return NextResponse.json({ ok: true, resolution, result: null });
    }

    await client.query("begin");
    const result = await executeCockpitIntent(client, session.user.id, resolution.intent);
    await client.query("commit");
    return NextResponse.json({ ok: true, resolution, result });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error instanceof CockpitCommandError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid command" }, { status: 400 });
    }
    console.error("Cockpit command failed", error);
    return NextResponse.json({ ok: false, error: "Command could not be completed" }, { status: 500 });
  } finally {
    client.release();
  }
}
