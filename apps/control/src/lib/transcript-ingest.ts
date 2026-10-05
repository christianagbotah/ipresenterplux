import type { PoolClient, QueryResultRow } from "pg";
import { db, query } from "@/lib/db";
import { publishServiceEvent } from "@/lib/realtime";
import { matchScriptureQuote } from "@/lib/scripture-quote";
import { latestTranscriptObservedAt, recordTranscriptSegment, recentTranscriptQuoteWindow, recentlyDetectedQuote } from "@/lib/transcript-window";
import { enqueueTranslationJobs } from "@/lib/translation-jobs";
import { resolveSpeakerAttribution } from "@/lib/speaker-attribution";
import {
  detectContextualScriptureIntent,
  detectScriptureReferences,
  hasExplicitScriptureAttempt,
  scriptureReference,
  type ContextualScriptureIntent,
  type ScriptureDetection,
} from "@/lib/scripture";

export type ServiceContext = {
  id: string;
  organization_id: string;
  campus_id: string | null;
  active_bible_version: string;
  auto_preview_threshold: string;
};

export type TranscriptInput = {
  text: string;
  bibleVersion?: string;
  startedAt?: string;
  language?: string | null;
  speakerId?: string | null;
  confidence?: number | null;
};

type TranscriptResult = {
  ok: true;
  serviceId: string;
  transcript: string;
  detected: number;
  translationJobsQueued: number;
  inserted: Array<{
    id: string;
    scripture_reference: string;
    confidence: string;
    state: string;
    detection_method: string;
    detected_at: string;
  }>;
};

type ScriptureContextRow = {
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number | null;
  bible_version: string;
  source_observed_at: string;
  source_ordinal: number;
};

type BibleVerseRow = {
  chapter: number;
  verse: number;
};

export async function findServiceById(serviceId: string) {
  const found = await query<ServiceContext>(
    `select id,organization_id::text,campus_id::text,active_bible_version,auto_preview_threshold::text
     from services where id=$1 limit 1`,
    [serviceId]
  );
  return found.rows[0];
}

export async function findActiveServiceForDevice(organizationId: string, campusId: string | null) {
  const found = await query<ServiceContext>(
    `select id,organization_id::text,campus_id::text,active_bible_version,auto_preview_threshold::text
     from services
     where organization_id=$1
       and status in ('live','ready')
       and ($2::uuid is null or campus_id=$2::uuid)
     order by case when status='live' then 0 else 1 end, created_at desc
     limit 1`,
    [organizationId, campusId]
  );
  return found.rows[0];
}

async function execute<T extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  values: unknown[] = []
) {
  return client ? client.query<T>(text, values) : query<T>(text, values);
}

async function localBibleVersionExists(client: PoolClient | undefined, versionId: string) {
  const found = await execute<{ id: string }>(
    client,
    "select id from bible_versions where id=$1 and local_enabled=true limit 1",
    [versionId]
  );
  return Boolean(found.rowCount);
}

async function findBookCode(client: PoolClient | undefined, versionId: string, book: string) {
  const found = await execute<{ book_code: string }>(
    client,
    "select book_code from bible_books where version_id=$1 and lower(canonical_name)=lower($2) limit 1",
    [versionId, book]
  );
  return found.rows[0]?.book_code;
}

async function validLocalRange(
  client: PoolClient | undefined,
  versionId: string,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd?: number
) {
  const bookCode = await findBookCode(client, versionId, book);
  if (!bookCode) return false;
  const end = verseEnd ?? verseStart;
  if (end < verseStart) return false;
  const found = await execute<{ verse_count: string }>(
    client,
    `select count(*)::text as verse_count
     from bible_verses
     where version_id=$1 and book_code=$2 and chapter=$3 and verse between $4 and $5`,
    [versionId, bookCode, chapter, verseStart, end]
  );
  return Number(found.rows[0]?.verse_count ?? 0) === end - verseStart + 1;
}

async function validateDirectReferences(
  client: PoolClient | undefined,
  versionId: string,
  matches: ScriptureDetection[]
) {
  const valid: ScriptureDetection[] = [];
  for (const match of matches) {
    if (await validLocalRange(
      client,
      versionId,
      match.book,
      match.chapter,
      match.verseStart,
      match.verseEnd
    )) valid.push(match);
  }
  return valid;
}

async function currentScriptureContext(client: PoolClient | undefined, serviceId: string) {
  const found = await execute<ScriptureContextRow>(
    client,
    `select book,chapter,verse_start,verse_end,bible_version,source_observed_at::text,source_ordinal
     from service_scripture_context where service_id=$1 limit 1`,
    [serviceId]
  );
  return found.rows[0];
}

async function latestScriptureContext(
  client: PoolClient | undefined,
  serviceId: string,
  observedAt: Date
) {
  const current = await execute<ScriptureContextRow>(
    client,
    `select book,chapter,verse_start,verse_end,bible_version,source_observed_at::text,source_ordinal
     from service_scripture_context
     where service_id=$1 and source_observed_at <= $2
     limit 1`,
    [serviceId, observedAt]
  );
  if (current.rows[0]) return current.rows[0];

  const historical = await execute<ScriptureContextRow>(
    client,
    `select book,chapter,verse_start,verse_end,bible_version,source_observed_at::text,source_ordinal
     from scripture_detections
     where service_id=$1 and book is not null and chapter is not null and verse_start is not null
       and state <> 'dismissed' and source_observed_at <= $2
     order by source_observed_at desc,source_ordinal desc,detected_at desc,id desc
     limit 1`,
    [serviceId, observedAt]
  );
  return historical.rows[0];
}

async function updateScriptureContext(
  client: PoolClient | undefined,
  serviceId: string,
  match: ScriptureDetection,
  bibleVersion: string,
  observedAt: Date,
  ordinal: number
) {
  await execute(
    client,
    `insert into service_scripture_context
      (service_id,book,chapter,verse_start,verse_end,bible_version,source_observed_at,source_ordinal,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,now())
     on conflict (service_id) do update set
       book=excluded.book,chapter=excluded.chapter,verse_start=excluded.verse_start,verse_end=excluded.verse_end,
       bible_version=excluded.bible_version,source_observed_at=excluded.source_observed_at,
       source_ordinal=excluded.source_ordinal,updated_at=now()
     where (excluded.source_observed_at,excluded.source_ordinal) >=
           (service_scripture_context.source_observed_at,service_scripture_context.source_ordinal)`,
    [serviceId,match.book,match.chapter,match.verseStart,match.verseEnd ?? null,bibleVersion,observedAt,ordinal]
  );
}

function contextualDetection(book: string, chapter: number, verseStart: number, verseEnd?: number): ScriptureDetection {
  return {
    book,
    chapter,
    verseStart,
    verseEnd,
    reference: scriptureReference(book, chapter, verseStart, verseEnd),
    confidence: 96,
    detectionMethod: "context",
  };
}

async function resolveRelativeVerse(
  client: PoolClient | undefined,
  versionId: string,
  context: ScriptureContextRow,
  direction: "next" | "previous"
) {
  const bookCode = await findBookCode(client, versionId, context.book);
  if (!bookCode) return null;
  const currentVerse = context.verse_end ?? context.verse_start;
  const comparison = direction === "next" ? ">" : "<";
  const ordering = direction === "next" ? "asc" : "desc";
  const found = await execute<BibleVerseRow>(
    client,
    `select chapter,verse from bible_verses
     where version_id=$1 and book_code=$2 and (chapter,verse) ${comparison} ($3,$4)
     order by chapter ${ordering},verse ${ordering}
     limit 1`,
    [versionId, bookCode, context.chapter, currentVerse]
  );
  const verse = found.rows[0];
  return verse ? contextualDetection(context.book, verse.chapter, verse.verse) : null;
}

async function resolveContextualReference(
  client: PoolClient | undefined,
  serviceId: string,
  versionId: string,
  intent: ContextualScriptureIntent,
  observedAt: Date
): Promise<ScriptureDetection | null> {
  const context = await latestScriptureContext(client, serviceId, observedAt);
  if (!context) return null;

  if (intent.kind === "nextVerse")
    return resolveRelativeVerse(client, versionId, context, "next");
  if (intent.kind === "previousVerse")
    return resolveRelativeVerse(client, versionId, context, "previous");

  if (intent.kind === "nextChapter") {
    const bookCode = await findBookCode(client, versionId, context.book);
    if (!bookCode) return null;
    const found = await execute<BibleVerseRow>(
      client,
      `select chapter,verse from bible_verses
       where version_id=$1 and book_code=$2 and chapter=$3
       order by verse asc limit 1`,
      [versionId, bookCode, context.chapter + 1]
    );
    const verse = found.rows[0];
    return verse ? contextualDetection(context.book, verse.chapter, verse.verse) : null;
  }

  if (intent.kind === "continue") {
    const verseStart = (context.verse_end ?? context.verse_start) + 1;
    if (intent.verseEnd < verseStart) return null;
    if (!await validLocalRange(client, versionId, context.book, context.chapter, verseStart, intent.verseEnd))
      return null;
    return contextualDetection(context.book, context.chapter, verseStart, intent.verseEnd);
  }

  if (!await validLocalRange(client, versionId, context.book, context.chapter, intent.verseStart, intent.verseEnd))
    return null;
  return contextualDetection(context.book, context.chapter, intent.verseStart, intent.verseEnd);
}

export async function publishTranscriptIngestResult(result: TranscriptResult) {
  await publishServiceEvent(result.serviceId, "transcript.updated", {
    detected: result.detected,
    translationJobsQueued: result.translationJobsQueued
  });

  if (!result.inserted.length) return;
  await publishServiceEvent(result.serviceId, "scripture.detected", {
    detections: result.inserted.map((item) => ({
      id: item.id,
      reference: item.scripture_reference,
      confidence: item.confidence,
      state: item.state,
      method: item.detection_method
    }))
  });
}

export async function ingestTranscriptForService(
  service: ServiceContext,
  payload: TranscriptInput,
  client?: PoolClient
): Promise<TranscriptResult> {
  if (!payload.text.trim()) {
    return { ok: true, serviceId: service.id, transcript: payload.text, detected: 0, translationJobsQueued: 0, inserted: [] };
  }

  if (!client) {
    const ownedClient = await db.connect();
    try {
      await ownedClient.query("begin");
      const result = await ingestTranscriptForService(service, payload, ownedClient);
      await ownedClient.query("commit");
      await publishTranscriptIngestResult(result);
      return result;
    } catch (error) {
      await ownedClient.query("rollback");
      throw error;
    } finally {
      ownedClient.release();
    }
  }

  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [service.id]);
  const bibleVersion = payload.bibleVersion ?? service.active_bible_version;
  const parsedObservedAt = payload.startedAt ? new Date(payload.startedAt) : new Date();
  const observedAt = Number.isFinite(parsedObservedAt.getTime()) ? parsedObservedAt : new Date();
  const latestTranscriptBefore = await latestTranscriptObservedAt(client, service.id);
  const speaker = await resolveSpeakerAttribution(client, service.id, service.organization_id, payload.speakerId);
  const transcriptSegmentId = await recordTranscriptSegment(client, service.id, payload.text, observedAt, {
    sourceLanguage: payload.language ?? null,
    speakerId: speaker.speakerId,
    speakerSource: speaker.speakerSource,
    asrConfidence: payload.confidence ?? null
  });
  const translationJobs = transcriptSegmentId
    ? await enqueueTranslationJobs(client, transcriptSegmentId, service.organization_id, payload.language ?? null)
    : [];
  const cursorBeforeIngest = await currentScriptureContext(client, service.id);
  const cursorObservedAt = cursorBeforeIngest ? new Date(cursorBeforeIngest.source_observed_at) : null;
  const cursorObservedMs = cursorObservedAt?.getTime() ?? null;
  const directMatches = detectScriptureReferences(payload.text);
  const explicitAttempt = hasExplicitScriptureAttempt(payload.text);
  const hasLocalBible = await localBibleVersionExists(client, bibleVersion);
  let matches = hasLocalBible
    ? await validateDirectReferences(client, bibleVersion, directMatches)
    : directMatches;
  let contextualIntent: ContextualScriptureIntent | null = null;

  if (directMatches.length === 0 && !explicitAttempt && hasLocalBible) {
    contextualIntent = detectContextualScriptureIntent(payload.text);
    if (contextualIntent) {
      const contextual = await resolveContextualReference(
        client, service.id, bibleVersion, contextualIntent, observedAt
      );
      if (contextual) matches = [contextual];
    }
  }

  if (matches.length === 0 && !explicitAttempt && contextualIntent === null && hasLocalBible) {
    let quoteMatch = await matchScriptureQuote(client, bibleVersion, payload.text);
    if (!quoteMatch) {
      const windowText = await recentTranscriptQuoteWindow(client, service.id, observedAt);
      if (windowText && windowText !== payload.text.trim()) {
        quoteMatch = await matchScriptureQuote(client, bibleVersion, windowText);
      }
    }
    if (quoteMatch && await recentlyDetectedQuote(client, service.id, quoteMatch.reference, observedAt)) {
      quoteMatch = null;
    }
    if (quoteMatch) matches = [quoteMatch];
  }

  const inserted: TranscriptResult["inserted"] = [];
  for (const [ordinal, match] of matches.entries()) {
    const observedMs = observedAt.getTime();
    const latestTranscriptMs = latestTranscriptBefore ? new Date(latestTranscriptBefore).getTime() : null;
    const staleByTranscript = latestTranscriptMs !== null && observedMs < latestTranscriptMs;
    const staleByCursor = cursorBeforeIngest !== undefined && cursorObservedMs !== null && (
      observedMs < cursorObservedMs ||
      (observedMs === cursorObservedMs && ordinal < cursorBeforeIngest.source_ordinal)
    );
    const staleForPreview = staleByTranscript || staleByCursor;
    const nextState = !staleForPreview && match.confidence >= Number(service.auto_preview_threshold)
      ? "preview"
      : "detected";
    if (nextState === "preview") {
      await execute(
        client,
        "update scripture_detections set state='detected' where service_id=$1 and state='preview'",
        [service.id]
      );
    }

    const result = await execute<TranscriptResult["inserted"][number]>(
      client,
      `insert into scripture_detections
        (service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id,scripture_reference,confidence::text,state,detection_method,detected_at::text`,
      [service.id,match.reference,match.book,match.chapter,match.verseStart,match.verseEnd ?? null,
       bibleVersion,match.matchedSourceText ?? payload.text,match.confidence,nextState,match.detectionMethod,observedAt,ordinal]
    );
    inserted.push(result.rows[0]);
    if (!staleForPreview) {
      await updateScriptureContext(client, service.id, match, bibleVersion, observedAt, ordinal);
    }
  }

  const result: TranscriptResult = {
    ok: true,
    serviceId: service.id,
    transcript: payload.text,
    detected: matches.length,
    translationJobsQueued: translationJobs.length,
    inserted
  };
  return result;
}
