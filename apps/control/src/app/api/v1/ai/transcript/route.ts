import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { detectScriptureReferences } from "@/lib/scripture";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  text: z.string().min(1).max(10_000),
  bibleVersion: z.string().min(2).max(40).optional()
});

type ServiceRow = {
  id: string;
  active_bible_version: string;
};

export async function POST(request: Request) {
  try {
    const payload = inputSchema.parse(await request.json());
    let service: ServiceRow | undefined;

    if (payload.serviceId) {
      const found = await query<ServiceRow>(
        "select id, active_bible_version from services where id = $1 limit 1",
        [payload.serviceId]
      );
      service = found.rows[0];
    } else {
      const found = await query<ServiceRow>(
        "select id, active_bible_version from services where status in ('live','ready') order by case when status='live' then 0 else 1 end, created_at desc limit 1"
      );
      service = found.rows[0];
    }

    if (!service) {
      return NextResponse.json({ ok: false, error: "No active or ready service found" }, { status: 404 });
    }

    const matches = detectScriptureReferences(payload.text);
    const inserted = [];

    for (const match of matches) {
      const duplicate = await query<{ id: string }>(
        "select id from scripture_detections where service_id=$1 and scripture_reference=$2 and detected_at > now() - interval '5 seconds' limit 1",
        [service.id, match.reference]
      );
      if (duplicate.rowCount) continue;

      const result = await query<{
        id: string;
        scripture_reference: string;
        confidence: string;
        detected_at: string;
      }>(
        "insert into scripture_detections (service_id, scripture_reference, book, chapter, verse_start, verse_end, bible_version, source_text, confidence) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, scripture_reference, confidence::text, detected_at::text",
        [
          service.id,
          match.reference,
          match.book,
          match.chapter,
          match.verseStart,
          match.verseEnd ?? null,
          payload.bibleVersion ?? service.active_bible_version,
          payload.text,
          match.confidence
        ]
      );
      inserted.push(result.rows[0]);
    }

    return NextResponse.json({
      ok: true,
      serviceId: service.id,
      transcript: payload.text,
      detected: matches.length,
      inserted
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid transcript payload", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Transcript processing failed" },
      { status: 500 }
    );
  }
}
