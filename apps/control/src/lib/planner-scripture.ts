import type { PoolClient } from "pg";
import { parseOperatorScriptureReference } from "./edge-operator-catalog.ts";
import { PlannerItemError } from "./planner-item-schemas.ts";

export type ResolvedPlannerScripture = {
  reference: string;
  version: string;
  versionAbbreviation: string;
  book: string;
  bookCode: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  passageText: string;
};

export async function resolvePlannerScripture(
  client: PoolClient,
  reference: string,
  version: string
): Promise<ResolvedPlannerScripture> {
  const parsed = parseOperatorScriptureReference(reference);
  if (!parsed) {
    throw new PlannerItemError("scripture_reference_invalid", "Scripture reference is invalid");
  }

  const versionResult = await client.query<{ id: string; abbreviation: string }>(
    `select id,abbreviation from bible_versions
     where upper(id)=upper($1) and local_enabled=true
     limit 1`,
    [version.trim()]
  );
  if (!versionResult.rowCount) {
    throw new PlannerItemError("scripture_version_unavailable", "Bible version is not available locally");
  }
  const bibleVersion = versionResult.rows[0];

  const bookResult = await client.query<{ book_code: string; canonical_name: string }>(
    `select book_code,canonical_name
     from bible_books
     where version_id=$1
       and (lower(canonical_name)=lower($2) or lower(book_code)=lower($2))
     limit 1`,
    [bibleVersion.id, parsed.book]
  );
  if (!bookResult.rowCount) {
    throw new PlannerItemError("scripture_book_not_found", "Scripture book was not found in the selected Bible version");
  }
  const book = bookResult.rows[0];

  const values: unknown[] = [bibleVersion.id, book.book_code, parsed.chapter];
  let sql = `select verse,text from bible_verses
             where version_id=$1 and book_code=$2 and chapter=$3`;
  if (parsed.verseStart !== null) {
    values.push(parsed.verseStart, parsed.verseEnd ?? parsed.verseStart);
    sql += ` and verse between $4 and $5`;
  }
  sql += ` order by verse limit 81`;
  const verseResult = await client.query<{ verse: number; text: string }>(sql, values);
  if (!verseResult.rowCount) {
    throw new PlannerItemError("scripture_passage_not_found", "Scripture passage was not found");
  }
  if (verseResult.rows.length > 80) {
    throw new PlannerItemError("scripture_reference_invalid", "Scripture passage exceeds the 80-verse safety limit");
  }

  const firstVerse = parsed.verseStart === null ? null : verseResult.rows[0].verse;
  const lastVerse = parsed.verseStart === null ? null : verseResult.rows[verseResult.rows.length - 1].verse;
  const canonicalReference = parsed.verseStart === null
    ? `${book.canonical_name} ${parsed.chapter}`
    : `${book.canonical_name} ${parsed.chapter}:${firstVerse}${lastVerse !== firstVerse ? `-${lastVerse}` : ""}`;

  return {
    reference: canonicalReference,
    version: bibleVersion.id,
    versionAbbreviation: bibleVersion.abbreviation,
    book: book.canonical_name,
    bookCode: book.book_code,
    chapter: parsed.chapter,
    verseStart: firstVerse,
    verseEnd: lastVerse,
    passageText: verseResult.rows.map((row) => row.text.trim()).filter(Boolean).join(" ")
  };
}
