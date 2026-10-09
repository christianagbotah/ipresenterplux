import type { PoolClient } from "pg";
import { parseOperatorScriptureReference } from "./edge-operator-catalog.ts";

export class BibleLibraryError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BibleLibraryError";
    this.code = code;
  }
}

export type LocalBibleVersion = {
  id: string;
  name: string;
  abbreviation: string;
  languageCode: string;
};

export type LocalBibleBook = {
  bookCode: string;
  canonicalName: string;
  bookOrder: number;
  testament: "OT" | "NT";
  chapterCount: number;
};

export type LocalBibleVerse = {
  verse: number;
  text: string;
};

export type ResolvedLocalScripture = {
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

type QueryClient = Pick<PoolClient, "query">;

const BOOK_ALIASES: Record<string, string> = {
  psalm: "Psalms"
};

function normalizeBookLookup(book: string) {
  const trimmed = book.trim();
  return BOOK_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function requireVersion(versionId: string) {
  const normalized = versionId.trim();
  if (!normalized || normalized.length > 32) {
    throw new BibleLibraryError("scripture_version_unavailable", "Bible version is not available locally");
  }
  return normalized;
}

export async function listLocalBibleVersions(client: QueryClient): Promise<LocalBibleVersion[]> {
  const result = await client.query<{
    id: string;
    name: string;
    abbreviation: string;
    language_code: string;
  }>(
    `select id,name,abbreviation,language_code
     from bible_versions
     where local_enabled=true
     order by name,id`
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    languageCode: row.language_code
  }));
}

export async function listBibleBooks(client: QueryClient, versionId: string): Promise<LocalBibleBook[]> {
  const version = requireVersion(versionId);
  const result = await client.query<{
    book_code: string;
    canonical_name: string;
    book_order: number;
    testament: "OT" | "NT";
    chapter_count: number;
  }>(
    `select bb.book_code,bb.canonical_name,bb.book_order,bb.testament,
            coalesce(max(bv.chapter),0)::int as chapter_count
     from bible_books bb
     left join bible_verses bv
       on bv.version_id=bb.version_id and bv.book_code=bb.book_code
     where bb.version_id=$1
     group by bb.book_code,bb.canonical_name,bb.book_order,bb.testament
     order by bb.book_order,bb.book_code`,
    [version]
  );

  return result.rows.map((row) => ({
    bookCode: row.book_code,
    canonicalName: row.canonical_name,
    bookOrder: Number(row.book_order),
    testament: row.testament,
    chapterCount: Number(row.chapter_count)
  }));
}

export async function listBibleChapter(
  client: QueryClient,
  versionId: string,
  bookCode: string,
  chapter: number
): Promise<LocalBibleVerse[]> {
  const version = requireVersion(versionId);
  const code = bookCode.trim();
  if (!code || code.length > 32 || !Number.isInteger(chapter) || chapter < 1 || chapter > 200) {
    throw new BibleLibraryError("scripture_reference_invalid", "Scripture chapter is invalid");
  }

  const result = await client.query<{ verse: number; text: string }>(
    `select verse,text
     from bible_verses
     where version_id=$1 and book_code=$2 and chapter=$3
     order by verse`,
    [version, code, chapter]
  );

  return result.rows.map((row) => ({ verse: Number(row.verse), text: row.text }));
}

export async function resolveLocalScripture(
  client: QueryClient,
  input: { reference: string; version: string }
): Promise<ResolvedLocalScripture> {
  const parsed = parseOperatorScriptureReference(input.reference);
  if (!parsed) {
    throw new BibleLibraryError("scripture_reference_invalid", "Scripture reference is invalid");
  }

  const version = requireVersion(input.version);
  const versionResult = await client.query<{ id: string; abbreviation: string }>(
    `select id,abbreviation
     from bible_versions
     where upper(id)=upper($1) and local_enabled=true
     limit 1`,
    [version]
  );
  if (!versionResult.rowCount) {
    throw new BibleLibraryError("scripture_version_unavailable", "Bible version is not available locally");
  }
  const bibleVersion = versionResult.rows[0];

  const bookLookup = normalizeBookLookup(parsed.book);
  const bookResult = await client.query<{ book_code: string; canonical_name: string }>(
    `select book_code,canonical_name
     from bible_books
     where version_id=$1
       and (lower(canonical_name)=lower($2) or lower(book_code)=lower($2))
     limit 1`,
    [bibleVersion.id, bookLookup]
  );
  if (!bookResult.rowCount) {
    throw new BibleLibraryError("scripture_book_not_found", "Scripture book was not found in the selected Bible version");
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
    throw new BibleLibraryError("scripture_passage_not_found", "Scripture passage was not found");
  }
  if (verseResult.rows.length > 80) {
    throw new BibleLibraryError("scripture_reference_invalid", "Scripture passage exceeds the 80-verse safety limit");
  }

  if (parsed.verseStart !== null) {
    const expectedCount = (parsed.verseEnd ?? parsed.verseStart) - parsed.verseStart + 1;
    if (verseResult.rows.length !== expectedCount) {
      throw new BibleLibraryError("scripture_passage_not_found", "Scripture passage was not found");
    }
  }

  const firstVerse = parsed.verseStart === null ? null : Number(verseResult.rows[0].verse);
  const lastVerse = parsed.verseStart === null ? null : Number(verseResult.rows[verseResult.rows.length - 1].verse);
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
