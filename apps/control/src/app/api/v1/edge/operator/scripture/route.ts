import { NextResponse } from "next/server";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { query } from "@/lib/db";
import {
  deterministicScriptureItemId,
  normalizeOperatorPresentationBody,
  normalizeOperatorText,
  parseOperatorScriptureReference,
} from "@/lib/edge-operator-catalog";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  active_bible_version: string;
};

type VersionRow = {
  id: string;
  abbreviation: string;
};

type BookRow = {
  book_code: string;
  canonical_name: string;
};

type VerseRow = {
  verse: number;
  text: string;
};

export async function GET(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawReference = url.searchParams.get("reference") ?? "";
  const parsed = parseOperatorScriptureReference(rawReference);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Invalid scripture reference" }, { status: 400 });
  }

  const serviceResult = await query<ServiceRow>(
    `select s.id::text,s.active_bible_version
     from edge_devices d
     join services s
       on s.id=d.active_service_id
      and s.organization_id=d.organization_id
      and s.campus_id is not distinct from d.campus_id
      and s.status in ('ready','live')
     where d.id=$1 and d.organization_id=$2 and d.status='active'
     limit 1`,
    [device.deviceId, device.organizationId],
  );
  const service = serviceResult.rows[0];
  if (!service) {
    return NextResponse.json({ ok: false, error: "No active service is assigned to this device" }, { status: 409 });
  }

  const requestedVersion = normalizeOperatorText(url.searchParams.get("version") ?? service.active_bible_version, 32);
  if (!requestedVersion) {
    return NextResponse.json({ ok: false, error: "Bible version is required" }, { status: 400 });
  }

  const versionResult = await query<VersionRow>(
    `select id,abbreviation
     from bible_versions
     where upper(id)=upper($1) and local_enabled=true
     limit 1`,
    [requestedVersion],
  );
  const version = versionResult.rows[0];
  if (!version) {
    return NextResponse.json({ ok: false, error: "Bible version is not available" }, { status: 404 });
  }

  const bookResult = await query<BookRow>(
    `select book_code,canonical_name
     from bible_books
     where version_id=$1
       and (lower(canonical_name)=lower($2) or lower(book_code)=lower($2))
     limit 1`,
    [version.id, parsed.book],
  );
  const book = bookResult.rows[0];
  if (!book) {
    return NextResponse.json({ ok: false, error: "Bible book is not available" }, { status: 404 });
  }

  const values: unknown[] = [version.id, book.book_code, parsed.chapter];
  let versePredicate = "";
  if (parsed.verseStart !== null && parsed.verseEnd !== null) {
    values.push(parsed.verseStart, parsed.verseEnd);
    versePredicate = "and verse between $4 and $5";
  }

  const versesResult = await query<VerseRow>(
    `select verse,text
     from bible_verses
     where version_id=$1 and book_code=$2 and chapter=$3
       ${versePredicate}
     order by verse
     limit 81`,
    values,
  );
  if (versesResult.rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Scripture passage is not available" }, { status: 404 });
  }
  if (versesResult.rows.length > 80) {
    return NextResponse.json({ ok: false, error: "Passage exceeds 80 verses; specify a smaller range" }, { status: 400 });
  }

  if (parsed.verseStart !== null && parsed.verseEnd !== null) {
    const expectedCount = parsed.verseEnd - parsed.verseStart + 1;
    if (versesResult.rows.length !== expectedCount ||
        versesResult.rows[0]?.verse !== parsed.verseStart ||
        versesResult.rows.at(-1)?.verse !== parsed.verseEnd) {
      return NextResponse.json({ ok: false, error: "Scripture passage is not available" }, { status: 404 });
    }
  }

  const verseStart = parsed.verseStart ?? versesResult.rows[0].verse;
  const verseEnd = parsed.verseEnd ?? versesResult.rows.at(-1)!.verse;
  const verseLabel = parsed.verseStart === null
    ? ""
    : verseEnd === verseStart
      ? `:${verseStart}`
      : `:${verseStart}-${verseEnd}`;
  const canonicalReference = `${book.canonical_name} ${parsed.chapter}${verseLabel}`;
  const body = normalizeOperatorPresentationBody(versesResult.rows.map((row) => row.text).join(" "));
  if (!body) {
    return NextResponse.json({ ok: false, error: "Scripture passage is not available" }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      item: {
        itemId: deterministicScriptureItemId(version.id, book.canonical_name, parsed.chapter, verseStart, verseEnd),
        serviceId: service.id,
        itemType: "scripture",
        title: canonicalReference,
        body,
        footer: normalizeOperatorText(version.abbreviation || version.id, 32),
        metadata: {
          book: normalizeOperatorText(book.canonical_name, 120),
          chapter: String(parsed.chapter),
          verses: verseStart === verseEnd ? String(verseStart) : `${verseStart}-${verseEnd}`,
          bibleVersion: normalizeOperatorText(version.id, 32),
        },
      },
      observedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
