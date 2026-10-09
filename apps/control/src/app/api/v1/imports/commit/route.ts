import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { PortableImportError, PORTABLE_IMPORT_KINDS } from "@/lib/imports/contracts";
import { PortableImportServiceError, commitPortableImport } from "@/lib/imports/import-service";

export const dynamic = "force-dynamic";

const sourceSchema = z.object({
  kind: z.enum(PORTABLE_IMPORT_KINDS),
  filename: z.string().trim().min(1).max(240),
  content: z.string().min(1)
}).strict();

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  source: sourceSchema,
  duplicatePolicy: z.enum(["skip", "import_copy"]).optional(),
  targetServiceId: z.string().uuid().optional(),
  expectedRevision: z.string().trim().min(1).max(180).optional()
}).strict();

function failure(error: unknown) {
  if (error instanceof PortableImportServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof PortableImportError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 422 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "Invalid portable import commit request", code: "portable_import_invalid" }, { status: 400 });
  }
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "portable_import_commit_failed";
  const message = error instanceof Error && status < 500 ? error.message : "Portable import commit failed";
  if (status >= 500) console.error("Portable import commit failed", error);
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  try {
    const input = bodySchema.parse(await request.json());
    const result = await commitPortableImport(db, session.user.id, input);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failure(error);
  }
}
