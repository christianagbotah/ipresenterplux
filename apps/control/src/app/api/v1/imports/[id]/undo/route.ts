import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { PortableImportServiceError, undoPortableImport } from "@/lib/imports/import-service";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof PortableImportServiceError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "portable_import_undo_failed";
  const message = error instanceof Error && status < 500 ? error.message : "Portable import undo failed";
  if (status >= 500) console.error("Portable import undo failed", error);
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid portable import batch id", code: "portable_import_batch_invalid" }, { status: 400 });
  }
  try {
    const result = await undoPortableImport(db, session.user.id, id);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failure(error);
  }
}
