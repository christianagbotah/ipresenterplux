import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { query } from "@/lib/db";
import {
  extractOperatorPresentationFields,
  normalizeOperatorPresentationBody,
  normalizeOperatorText,
} from "@/lib/edge-operator-catalog";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  title: string;
  status: string;
  active_bible_version: string;
  scheduled_start: string | null;
  started_at: string | null;
  updated_at: string;
};

type BibleVersionRow = {
  id: string;
  name: string;
  abbreviation: string;
  language_code: string;
};

type PresentationRow = {
  id: string;
  item_type: string;
  title: string;
  content: unknown;
  sort_order: number;
  state: string;
  updated_at: string;
};

type ScriptureRow = {
  id: string;
  scripture_reference: string;
  bible_version: string;
  book: string;
  chapter: number;
  verse_start: number | null;
  verse_end: number | null;
  source_text: string | null;
  passage_text: string | null;
  state: string;
  detected_at: string;
};

function revision(parts: Array<string | null | undefined>) {
  return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 24);
}

export async function GET(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  const [serviceResult, versionsResult] = await Promise.all([
    query<ServiceRow>(
      `select s.id::text,s.title,s.status,s.active_bible_version,
              s.scheduled_start::text,s.started_at::text,s.updated_at::text
       from edge_devices d
       join services s
         on s.id=d.active_service_id
        and s.organization_id=d.organization_id
        and s.campus_id is not distinct from d.campus_id
        and s.status in ('ready','live')
       where d.id=$1 and d.organization_id=$2 and d.status='active'
       limit 1`,
      [device.deviceId, device.organizationId],
    ),
    query<BibleVersionRow>(
      `select id,name,abbreviation,language_code
       from bible_versions
       where local_enabled=true
       order by name,id
       limit 32`,
    ),
  ]);

  const service = serviceResult.rows[0] ?? null;
  const bibleVersions = versionsResult.rows.map((row) => ({
    id: normalizeOperatorText(row.id, 32),
    name: normalizeOperatorText(row.name, 120),
    abbreviation: normalizeOperatorText(row.abbreviation, 32),
    languageCode: normalizeOperatorText(row.language_code, 16),
  }));
  const observedAt = new Date().toISOString();

  if (!service) {
    return NextResponse.json(
      {
        ok: true,
        service: null,
        bibleVersions,
        items: [],
        scriptureQueue: [],
        catalogRevision: revision(["no-service", ...bibleVersions.map((item) => item.id)]),
        observedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [presentationResult, scriptureResult] = await Promise.all([
    query<PresentationRow>(
      `select id::text,item_type,title,content,sort_order,state,updated_at::text
       from presentation_items
       where service_id=$1
       order by sort_order,id
       limit 200`,
      [service.id],
    ),
    query<ScriptureRow>(
      `select sd.id::text,sd.scripture_reference,sd.bible_version,sd.book,sd.chapter,
              sd.verse_start,sd.verse_end,sd.source_text,sd.state,sd.detected_at::text,
              coalesce((
                select string_agg(bv.text, ' ' order by bv.verse)
                from bible_books bb
                join bible_verses bv
                  on bv.version_id=bb.version_id and bv.book_code=bb.book_code
                where bb.version_id=sd.bible_version
                  and lower(bb.canonical_name)=lower(sd.book)
                  and bv.chapter=sd.chapter
                  and sd.verse_start is not null
                  and bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start)
              ),sd.source_text) as passage_text
       from scripture_detections sd
       where sd.service_id=$1 and sd.state <> 'dismissed'
       order by sd.detected_at desc,sd.id
       limit 200`,
      [service.id],
    ),
  ]);

  const items = presentationResult.rows.map((row) => {
    const fields = extractOperatorPresentationFields(row.content);
    const title = normalizeOperatorText(row.title, 200);
    return {
      itemId: row.id,
      itemType: normalizeOperatorText(row.item_type, 32),
      title,
      body: fields.body || title,
      footer: fields.footer,
      metadata: {
        ...fields.metadata,
        state: normalizeOperatorText(row.state, 32),
        sortOrder: String(row.sort_order),
      },
    };
  });

  const scriptureQueue = scriptureResult.rows.map((row) => {
    const verseLabel = row.verse_start === null
      ? ""
      : row.verse_end && row.verse_end !== row.verse_start
        ? `${row.verse_start}-${row.verse_end}`
        : String(row.verse_start);
    return {
      itemId: row.id,
      itemType: "scripture",
      title: normalizeOperatorText(row.scripture_reference, 200),
      body: normalizeOperatorPresentationBody(row.passage_text ?? row.source_text ?? row.scripture_reference),
      footer: normalizeOperatorText(row.bible_version, 32) || null,
      metadata: {
        book: normalizeOperatorText(row.book, 120),
        chapter: String(row.chapter),
        verses: verseLabel,
        bibleVersion: normalizeOperatorText(row.bible_version, 32),
        state: normalizeOperatorText(row.state, 32),
      },
    };
  });

  const latestPresentation = presentationResult.rows.reduce<string | null>(
    (latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest,
    null,
  );
  const latestScripture = scriptureResult.rows.reduce<string | null>(
    (latest, row) => !latest || row.detected_at > latest ? row.detected_at : latest,
    null,
  );

  return NextResponse.json(
    {
      ok: true,
      service: {
        serviceId: service.id,
        title: normalizeOperatorText(service.title, 200),
        status: normalizeOperatorText(service.status, 32),
        activeBibleVersion: normalizeOperatorText(service.active_bible_version, 32),
        scheduledStart: service.scheduled_start,
        startedAt: service.started_at,
      },
      bibleVersions,
      items,
      scriptureQueue,
      catalogRevision: revision([service.id, service.updated_at, latestPresentation, latestScripture]),
      observedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
