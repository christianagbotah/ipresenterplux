import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { INGEST_ROLES, userHasAnyRole } from "@/lib/rbac";
import { detectScriptureReferences } from "@/lib/scripture";
import { publishServiceEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  text: z.string().min(1).max(10_000),
  bibleVersion: z.string().min(2).max(40).optional()
});

type ServiceRow = {
  id: string;
  organization_id: string;
  active_bible_version: string;
  auto_preview_threshold: string;
};

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }

    const payload = inputSchema.parse(await request.json());
    let service: ServiceRow | undefined;

    if (payload.serviceId) {
      const found = await query<ServiceRow>(
        "select id, organization_id::text, active_bible_version, auto_preview_threshold::text from services where id = $1 limit 1",
        [payload.serviceId]
      );
      service = found.rows[0];
    } else {
      const found = await query<ServiceRow>(
        "select id, organization_id::text, active_bible_version, auto_preview_threshold::text from services where status in ('live','ready') order by case when status='live' then 0 else 1 end, created_at desc limit 1"
      );
      service = found.rows[0];
    }

    if (!service) {
      return NextResponse.json({ ok: false, error: "No active or ready service found" }, { status: 404 });
    }

    const allowed = await userHasAnyRole(session.user.id, service.organization_id, INGEST_ROLES);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "You are not allowed to ingest live transcript events" }, { status: 403 });
    }

    const matches = detectScriptureReferences(payload.text);
    const inserted = [];

    for (const match of matches) {
      const duplicate = await query<{ id: string }>(
        "select id from scripture_detections where service_id=$1 and scripture_reference=$2 and detected_at > now() - interval '5 seconds' limit 1",
        [service.id, match.reference]
      );
      if (duplicate.rowCount) continue;

      const nextState =
        match.confidence >= Number(service.auto_preview_threshold) ? "preview" : "detected";

      if (nextState === "preview") {
        await query(
          "update scripture_detections set state='detected' where service_id=$1 and state='preview'",
          [service.id]
        );
      }

      const result = await query<{
        id: string;
        scripture_reference: string;
        confidence: string;
        state: string;
        detected_at: string;
      }>(
        "insert into scripture_detections (service_id, scripture_reference, book, chapter, verse_start, verse_end, bible_version, source_text, confidence, state) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, scripture_reference, confidence::text, state, detected_at::text",
        [
          service.id,
          match.reference,
          match.book,
          match.chapter,
          match.verseStart,
          match.verseEnd ?? null,
          payload.bibleVersion ?? service.active_bible_version,
          payload.text,
          match.confidence,
          nextState
        ]
      );
      inserted.push(result.rows[0]);
    }

    if (inserted.length) {
      await publishServiceEvent(service.id, "scripture.detected", {
        detections: inserted.map((item) => ({
          id: item.id,
          reference: item.scripture_reference,
          confidence: item.confidence,
          state: item.state
        }))
      });
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
