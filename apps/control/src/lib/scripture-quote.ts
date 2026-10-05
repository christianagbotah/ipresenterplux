import type { PoolClient } from "pg";
import { scriptureReference, type ScriptureDetection } from "@/lib/scripture";

const MIN_QUOTE_WORDS = 5;
const MIN_QUOTE_CHARACTERS = 24;
const MAX_QUOTE_CHARACTERS = 1_200;
const CANDIDATE_WORD_SIMILARITY = 0.38;
const PASSAGE_CANDIDATE_WORD_SIMILARITY = 0.24;
const MIN_ACCEPTED_WORD_SIMILARITY = 0.70;
const MIN_PASSAGE_WORD_SIMILARITY = 0.78;
const MIN_RUNNER_UP_MARGIN = 0.12;
const MIN_PASSAGE_RUNNER_UP_MARGIN = 0.08;
const MIN_WHOLE_SIMILARITY = 0.15;
const MIN_PASSAGE_WHOLE_SIMILARITY = 0.12;

type QuoteCandidateRow = {
  book: string;
  chapter: number;
  verse: number;
  quote_score: number;
  whole_score: number;
};

type PassageQuoteCandidateRow = {
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
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

function accepted(score: number, wholeScore: number, margin: number) {
  return Number.isFinite(score)
    && score >= MIN_ACCEPTED_WORD_SIMILARITY
    && Number.isFinite(wholeScore)
    && wholeScore >= MIN_WHOLE_SIMILARITY
    && Number.isFinite(margin)
    && margin >= MIN_RUNNER_UP_MARGIN;
}

function acceptedPassage(score: number, wholeScore: number, margin: number) {
  return Number.isFinite(score)
    && score >= MIN_PASSAGE_WORD_SIMILARITY
    && Number.isFinite(wholeScore)
    && wholeScore >= MIN_PASSAGE_WHOLE_SIMILARITY
    && Number.isFinite(margin)
    && margin >= MIN_PASSAGE_RUNNER_UP_MARGIN;
}

async function matchContiguousPassage(
  client: PoolClient,
  versionId: string,
  quote: string,
  transcript: string
): Promise<ScriptureDetection | null> {
  await client.query("select set_config($1,$2,true)", [
    "pg_trgm.word_similarity_threshold",
    String(PASSAGE_CANDIDATE_WORD_SIMILARITY)
  ]);

  const candidates = await client.query<PassageQuoteCandidateRow>(
    `with seeds as (
       select bv.version_id,bv.book_code,bv.chapter,bv.verse
       from bible_verses bv
       where bv.version_id=$1
         and lower(bv.text) %> $2
       order by word_similarity($2,lower(bv.text)) desc,bv.book_code,bv.chapter,bv.verse
       limit 18
     ), starts as (
       select distinct s.version_id,s.book_code,s.chapter,v.start_verse
       from seeds s
       cross join lateral (values (s.verse-2),(s.verse-1),(s.verse)) v(start_verse)
       where v.start_verse > 0
     ), passages as (
       select st.version_id,st.book_code,st.chapter,st.start_verse as verse_start,
              st.start_verse+1 as verse_end,
              concat_ws(' ',v1.text,v2.text) as passage_text
       from starts st
       join bible_verses v1 on v1.version_id=st.version_id and v1.book_code=st.book_code
         and v1.chapter=st.chapter and v1.verse=st.start_verse
       join bible_verses v2 on v2.version_id=st.version_id and v2.book_code=st.book_code
         and v2.chapter=st.chapter and v2.verse=st.start_verse+1
       union all
       select st.version_id,st.book_code,st.chapter,st.start_verse,
              st.start_verse+2,
              concat_ws(' ',v1.text,v2.text,v3.text)
       from starts st
       join bible_verses v1 on v1.version_id=st.version_id and v1.book_code=st.book_code
         and v1.chapter=st.chapter and v1.verse=st.start_verse
       join bible_verses v2 on v2.version_id=st.version_id and v2.book_code=st.book_code
         and v2.chapter=st.chapter and v2.verse=st.start_verse+1
       join bible_verses v3 on v3.version_id=st.version_id and v3.book_code=st.book_code
         and v3.chapter=st.chapter and v3.verse=st.start_verse+2
     )
     select bb.canonical_name as book,p.chapter,p.verse_start,p.verse_end,
            word_similarity($2,lower(p.passage_text))::float8 as quote_score,
            similarity(lower(p.passage_text),$2)::float8 as whole_score
     from passages p
     join bible_books bb on bb.version_id=p.version_id and bb.book_code=p.book_code
     order by (word_similarity($2,lower(p.passage_text))*0.72 + similarity(lower(p.passage_text),$2)*0.28) desc,
              (p.verse_end-p.verse_start) asc,quote_score desc,whole_score desc,
              bb.book_order,p.chapter,p.verse_start,p.verse_end
     limit 10`,
    [versionId, quote]
  );

  const top = candidates.rows[0];
  if (!top) return null;

  const score = Number(top.quote_score);
  const wholeScore = Number(top.whole_score);
  const distinctRunnerUp = candidates.rows.slice(1).find((candidate) =>
    candidate.book !== top.book
    || candidate.chapter !== top.chapter
    || candidate.verse_end < top.verse_start - 1
    || candidate.verse_start > top.verse_end + 1
  );
  const runnerUp = Number(distinctRunnerUp?.quote_score ?? 0);
  const margin = score - runnerUp;
  if (!acceptedPassage(score, wholeScore, margin)) return null;

  return {
    book: top.book,
    chapter: top.chapter,
    verseStart: top.verse_start,
    verseEnd: top.verse_end,
    reference: scriptureReference(top.book, top.chapter, top.verse_start, top.verse_end),
    confidence: quoteConfidence(score, margin),
    detectionMethod: "quote",
    matchedSourceText: transcript
  };
}

export async function matchScriptureQuote(
  client: PoolClient,
  versionId: string,
  transcript: string
): Promise<ScriptureDetection | null> {
  const quote = normalizeScriptureQuote(transcript);
  const words = quote.match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < MIN_QUOTE_WORDS || quote.length < MIN_QUOTE_CHARACTERS || quote.length > MAX_QUOTE_CHARACTERS) return null;

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
  if (top) {
    const score = Number(top.quote_score);
    const wholeScore = Number(top.whole_score);
    const runnerUp = Number(candidates.rows[1]?.quote_score ?? 0);
    const margin = score - runnerUp;
    if (accepted(score, wholeScore, margin)) {
      return {
        book: top.book,
        chapter: top.chapter,
        verseStart: top.verse,
        reference: scriptureReference(top.book, top.chapter, top.verse),
        confidence: quoteConfidence(score, margin),
        detectionMethod: "quote",
        matchedSourceText: transcript
      };
    }
  }

  return matchContiguousPassage(client, versionId, quote, transcript);
}
