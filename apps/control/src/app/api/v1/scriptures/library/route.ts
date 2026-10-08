import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import {
  BibleLibraryError,
  listBibleBooks,
  listBibleChapter,
  listLocalBibleVersions,
  resolveLocalScripture
} from "@/lib/bible-library";
import { db, query } from "@/lib/db";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ ok: false, error: "Authentication required" }, 401);
  if (session.user.forcePasswordChange) return json({ ok: false, error: "Password change required" }, 403);

  try {
    const membership = await query<{ allowed: boolean }>(
      `select exists(
         select 1 from user_organization_roles where user_id=$1
       ) as allowed`,
      [session.user.id]
    );
    if (!membership.rows[0]?.allowed) {
      return json({ ok: false, error: "Church organization membership is required" }, 403);
    }

    const url = new URL(request.url);
    const version = url.searchParams.get("version")?.trim() ?? "";
    const reference = url.searchParams.get("reference")?.trim() ?? "";
    const book = url.searchParams.get("book")?.trim() ?? "";
    const chapterRaw = url.searchParams.get("chapter")?.trim() ?? "";

    const versions = await listLocalBibleVersions(db);
    if (!version) return json({ ok: true, versions, books: [], verses: [] });
    if (!versions.some((item) => item.id.toUpperCase() === version.toUpperCase())) {
      return json({ ok: false, error: "Bible version is not available locally", code: "scripture_version_unavailable" }, 404);
    }

    if (reference) {
      const passage = await resolveLocalScripture(db, { reference, version });
      return json({ ok: true, versions, passage });
    }

    const books = await listBibleBooks(db, version);
    if (!book || !chapterRaw) return json({ ok: true, versions, books, verses: [] });

    const chapter = z.coerce.number().int().min(1).max(200).parse(chapterRaw);
    if (!books.some((item) => item.bookCode.toUpperCase() === book.toUpperCase())) {
      return json({ ok: false, error: "Bible book is not available in this version", code: "scripture_book_not_found" }, 404);
    }
    const verses = await listBibleChapter(db, version, book, chapter);
    return json({ ok: true, versions, books, verses, chapter });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ ok: false, error: "Invalid Bible chapter", code: "scripture_reference_invalid" }, 400);
    }
    if (error instanceof BibleLibraryError) {
      const missing = ["scripture_version_unavailable", "scripture_book_not_found", "scripture_passage_not_found"].includes(error.code);
      return json({ ok: false, error: error.message, code: error.code }, missing ? 404 : 422);
    }
    console.error("Bible library request failed", error instanceof Error ? error.name : "unknown");
    return json({ ok: false, error: "Local Bible library could not be loaded" }, 500);
  }
}
