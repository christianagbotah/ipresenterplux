import type { PoolClient } from "pg";
import { scriptureReference, type ScriptureDetection } from "@/lib/scripture";

const MIN_QUOTE_WORDS = 5;
const MIN_QUOTE_CHARACTERS = 24;
const CANDIDATE_WORD_SIMILARITY = 0.38;
const MIN_ACCEPTED_WORD_SIMILARITY = 0.70;
const MIN_RUNNER_UP_MARGIN = 0.12;
const MIN_WHOLE_SIMILARITY = 0.15;

type QuoteCandidateRow = {
  book: string;
  chapter: number;
  verse: number;
  quote_score: number;
  whole_score: number;
};

export function normalizeScriptureQuote(input: string) {
  return input
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(?:the\s+)?(?:bible|scripture|word(?:\s+of\s+god)?)\s+(?:says?|said|tells?\s+us)(?:\s+that)?\s+/,
      ""
    )
    .trim();
}

function quoteConfidence(score: number, margin: number) {
  const confidence = 86 + Math.max(0, score - MIN_ACCEPTED_WORD_SIMILARITY) * 25
    + Math.min(0.25, Math.max(0, margin)) * 20;
  return Math.min(96, Math.max(86, Math.round(confidence * 100) / 100));
}

export async function matchScriptureQuote(
  client: PoolClient,
  versionId: string,
  transcript: string
): Promise<ScriptureDetection | null> {
  const quote = normalizeScriptureQuote(transcript);
  const words = quote.match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < MIN_QUOTE_WORDS || quote.length < MIN_QUOTE_CHARACTERS) return null;

  await client.query("select set_config($1,$2,true)", [
    "pg_trgm.word_similarity_threshold",
    String(CANDIDATE_WORD_SIMILARITY)
  ]);

  const candidates = await client.query<QuoteCandidateRow>(
    `select bb.canonical_name as book,bv.chapter,bv.verse,
            word_similarity($2,lower(bv.text))::float8 as quote_score,
            similarity(lower(bv.text),$2)::float8 as whole_score
     from bible_verses bv
     join bible_books bb
       on bb.version_id=bv.version_id and bb.book_code=bv.book_code
     where bv.version_id=$1
       and lower(bv.text) %> $2
     order by quote_score desc,whole_score desc,bb.book_order,bv.chapter,bv.verse
     limit 4`,
    [versionId, quote]
  );

  const top = candidates.rows[0];
  if (!top) return null;

  const score = Number(top.quote_score);
  const wholeScore = Number(top.whole_score);
  const runnerUp = Number(candidates.rows[1]?.quote_score ?? 0);
  const margin = score - runnerUp;

  if (!Number.isFinite(score) || score < MIN_ACCEPTED_WORD_SIMILARITY) return null;
  if (!Number.isFinite(wholeScore) || wholeScore < MIN_WHOLE_SIMILARITY) return null;
  if (!Number.isFinite(margin) || margin < MIN_RUNNER_UP_MARGIN) return null;

  return {
    book: top.book,
    chapter: top.chapter,
    verseStart: top.verse,
    reference: scriptureReference(top.book, top.chapter, top.verse),
    confidence: quoteConfidence(score, margin),
    detectionMethod: "quote"
  };
}
