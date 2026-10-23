import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { query } from "@/lib/db";
import {
  normalizeOperatorPresentationBody,
  normalizeOperatorText,
  normalizeOperatorTimestamp,
} from "@/lib/edge-operator-catalog";
import { normalizeEdgePresentationCatalogFields } from "@/lib/edge-presentation-resolver";
import {
  EdgeOperatorLibraryError,
  normalizeEdgeOperatorLibrarySummary,
  type EdgeOperatorLibraryRow,
} from "@/lib/edge-operator-library";
import {
  EDGE_OPERATOR_ACTIVE_SERVICE_SQL,
  EDGE_OPERATOR_BIBLE_VERSIONS_SQL,
  EDGE_OPERATOR_LIBRARY_ITEMS_SQL,
  EDGE_OPERATOR_PRESENTATION_ITEMS_SQL,
  EDGE_OPERATOR_SCRIPTURE_QUEUE_SQL,
} from "@/lib/edge-operator-catalog-queries";

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

  const [serviceResult, versionsResult, libraryResult] = await Promise.all([
    query<ServiceRow>(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [device.deviceId, device.organizationId]),
    query<BibleVersionRow>(EDGE_OPERATOR_BIBLE_VERSIONS_SQL),
    query<EdgeOperatorLibraryRow>(EDGE_OPERATOR_LIBRARY_ITEMS_SQL, [device.organizationId]),
  ]);

  const service = serviceResult.rows[0] ?? null;
  const bibleVersions = versionsResult.rows.map((row) => ({
    id: normalizeOperatorText(row.id, 32),
    name: normalizeOperatorText(row.name, 120),
    abbreviation: normalizeOperatorText(row.abbreviation, 32),
    languageCode: normalizeOperatorText(row.language_code, 16),
  }));
  const libraryItems = libraryResult.rows.flatMap((row) => {
    try {
      return [normalizeEdgeOperatorLibrarySummary(row)];
    } catch (error) {
      if (error instanceof EdgeOperatorLibraryError) return [];
      throw error;
    }
  });
  const latestLibrary = libraryResult.rows.reduce<string | null>(
    (latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest,
    null,
  );
  const observedAt = new Date().toISOString();

  if (!service) {
    return NextResponse.json(
      {
        ok: true,
        service: null,
        bibleVersions,
        items: [],
        scriptureQueue: [],
        libraryItems,
        catalogRevision: revision(["no-service", latestLibrary, ...bibleVersions.map((item) => item.id)]),
        observedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [presentationResult, scriptureResult] = await Promise.all([
    query<PresentationRow>(EDGE_OPERATOR_PRESENTATION_ITEMS_SQL, [service.id]),
    query<ScriptureRow>(EDGE_OPERATOR_SCRIPTURE_QUEUE_SQL, [service.id]),
  ]);

  const items = presentationResult.rows.map((row) => {
    const fields = normalizeEdgePresentationCatalogFields(row.item_type, row.title, row.content);
    return {
      itemId: row.id,
      itemType: fields.itemType,
      title: fields.title,
      body: fields.body || fields.title,
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
        scheduledStart: normalizeOperatorTimestamp(service.scheduled_start),
        startedAt: normalizeOperatorTimestamp(service.started_at),
      },
      bibleVersions,
      items,
      scriptureQueue,
      libraryItems,
      catalogRevision: revision([service.id, service.updated_at, latestPresentation, latestScripture, latestLibrary]),
      observedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
