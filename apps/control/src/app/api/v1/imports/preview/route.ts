import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { PortableImportError, PORTABLE_IMPORT_KINDS } from "@/lib/imports/contracts";
import { PortableImportServiceError, previewPortableImport } from "@/lib/imports/import-service";

export const dynamic = "force-dynamic";

const sourceSchema = z.object({
  kind: z.enum(PORTABLE_IMPORT_KINDS),
  filename: z.string().trim().min(1).max(240),
  content: z.string().min(1)
}).strict();

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  source: sourceSchema
}).strict();

function failure(error: unknown) {
  if (error instanceof PortableImportServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof PortableImportError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 422 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid portable import preview request", code: "portable_import_invalid" }, { status: 400 });
  }
  console.error("Portable import preview failed", error);
  return NextResponse.json({ ok: false, error: "Portable import preview failed" }, { status: 500 });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  const client = await db.connect();
  try {
    const input = bodySchema.parse(await request.json());
    const preview = await previewPortableImport(client, session.user.id, input);
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return failure(error);
  } finally {
    client.release();
  }
}
