import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";

type RouteContext = { params: Promise<{ id: string }> };

type ScriptureRenderRow = {
  item_id: string;
  service_id: string;
  scripture_reference: string;
  bible_version: string;
  book: string;
  chapter: number;
  verse_start: number | null;
  verse_end: number | null;
  source_text: string | null;
  passage_text: string | null;
};

export async function GET(request: Request, context: RouteContext) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid presentation item id" }, { status: 400 });
  }

  const found = await query<ScriptureRenderRow>(
    `select sd.id::text as item_id,sd.service_id::text,sd.scripture_reference,sd.bible_version,
            sd.book,sd.chapter,sd.verse_start,sd.verse_end,sd.source_text,
            coalesce((
              select string_agg(bv.text, ' ' order by bv.verse)
              from bible_books bb
              join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
              where bb.version_id=sd.bible_version
                and lower(bb.canonical_name)=lower(sd.book)
                and bv.chapter=sd.chapter
                and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))
            ),sd.source_text) as passage_text
     from scripture_detections sd
     join services s on s.id=sd.service_id
     join edge_devices d on d.id=$2
     where sd.id=$1
       and s.organization_id=$3
       and d.organization_id=$3
       and d.status='active'
       and d.active_service_id=sd.service_id
     limit 1`,
    [id, device.deviceId, device.organizationId]
  );

  const row = found.rows[0];
  if (!row) return NextResponse.json({ ok: false, error: "Presentation item not available for this device" }, { status: 404 });

  const verseLabel = row.verse_start === null
    ? null
    : row.verse_end && row.verse_end !== row.verse_start
      ? `${row.verse_start}-${row.verse_end}`
      : String(row.verse_start);

  return NextResponse.json({
    ok: true,
    item: {
      itemId: row.item_id,
      serviceId: row.service_id,
      itemType: "scripture",
      title: row.scripture_reference,
      body: row.passage_text ?? "",
      footer: row.bible_version,
      metadata: {
        book: row.book,
        chapter: String(row.chapter),
        verses: verseLabel ?? "",
        bibleVersion: row.bible_version
      }
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
