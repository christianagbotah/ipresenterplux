import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const controlRoot = path.resolve(import.meta.dirname, "..");
const libraryPath = path.join(controlRoot, "src/lib/bible-library.ts");
assert.ok(existsSync(libraryPath), "bible-library.ts must exist");

const {
  BibleLibraryError,
  listLocalBibleVersions,
  listBibleBooks,
  listBibleChapter,
  resolveLocalScripture
} = await import(pathToFileURL(libraryPath).href + `?selftest=${Date.now()}`);

const versions = [
  { id: "WEBP", name: "World English Bible, Protestant", abbreviation: "WEBP", language_code: "en" }
];
const books = [
  { version_id: "WEBP", book_code: "PSA", canonical_name: "Psalms", book_order: 19, testament: "OT", chapter_count: 150 },
  { version_id: "WEBP", book_code: "JHN", canonical_name: "John", book_order: 43, testament: "NT", chapter_count: 21 }
];
const verses = [
  { version_id: "WEBP", book_code: "JHN", chapter: 3, verse: 16, text: "For God so loved the world." },
  { version_id: "WEBP", book_code: "JHN", chapter: 3, verse: 17, text: "For God did not send his Son to condemn the world." },
  { version_id: "WEBP", book_code: "JHN", chapter: 3, verse: 18, text: "He who believes in him is not judged." },
  { version_id: "WEBP", book_code: "PSA", chapter: 23, verse: 1, text: "The LORD is my shepherd; I shall lack nothing." },
  { version_id: "WEBP", book_code: "PSA", chapter: 23, verse: 2, text: "He makes me lie down in green pastures." },
  { version_id: "WEBP", book_code: "PSA", chapter: 23, verse: 3, text: "He restores my soul." },
  { version_id: "WEBP", book_code: "PSA", chapter: 23, verse: 4, text: "Even though I walk through the valley, I will fear no evil." },
  { version_id: "WEBP", book_code: "PSA", chapter: 23, verse: 5, text: "You prepare a table before me." },
  { version_id: "WEBP", book_code: "PSA", chapter: 23, verse: 6, text: "Surely goodness and loving kindness shall follow me." }
];

class FakeBibleClient {
  async query(sql, values = []) {
    const q = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (q.includes("from bible_versions") && q.includes("order by")) {
      return { rowCount: versions.length, rows: versions };
    }
    if (q.includes("from bible_versions") && q.includes("where upper(id)=upper($1)")) {
      const rows = versions.filter((row) => row.id.toUpperCase() === String(values[0]).toUpperCase());
      return { rowCount: rows.length, rows };
    }
    if (q.includes("from bible_books") && q.includes("group by") && q.includes("order by")) {
      const rows = books.filter((row) => row.version_id === values[0]);
      return { rowCount: rows.length, rows };
    }
    if (q.includes("from bible_books") && q.includes("limit 1")) {
      const candidate = String(values[1]).toLowerCase();
      const rows = books.filter((row) =>
        row.version_id === values[0] &&
        (row.canonical_name.toLowerCase() === candidate || row.book_code.toLowerCase() === candidate)
      );
      return { rowCount: rows.length, rows };
    }
    if (q.includes("from bible_verses") && q.includes("order by verse")) {
      let rows = verses.filter((row) => row.version_id === values[0] && row.book_code === values[1] && row.chapter === values[2]);
      if (q.includes("verse between $4 and $5")) {
        rows = rows.filter((row) => row.verse >= values[3] && row.verse <= values[4]);
      }
      const limit = q.includes("limit 81") ? 81 : Number.POSITIVE_INFINITY;
      rows = rows.slice(0, limit).map(({ verse, text }) => ({ verse, text }));
      return { rowCount: rows.length, rows };
    }

    throw new Error(`Unhandled fake Bible query: ${q}`);
  }
}

const client = new FakeBibleClient();

const plannerPath = path.join(controlRoot, "src/lib/planner-scripture.ts");
const plannerModule = await import(pathToFileURL(plannerPath).href + `?selftest=${Date.now()}`);
const plannerPsalm = await plannerModule.resolvePlannerScripture(client, "Psalm 23", "WEBP");
assert.equal(plannerPsalm.book, "Psalms", "Planner must delegate to the shared resolver and preserve Psalm alias support");

const listedVersions = await listLocalBibleVersions(client);
assert.deepEqual(listedVersions.map((item) => item.id), ["WEBP"]);
const listedBooks = await listBibleBooks(client, "WEBP");
assert.deepEqual(listedBooks.map((item) => item.bookCode), ["PSA", "JHN"]);
const john3 = await listBibleChapter(client, "WEBP", "JHN", 3);
assert.deepEqual(john3.map((item) => item.verse), [16, 17, 18]);

const single = await resolveLocalScripture(client, { reference: "John 3:16", version: "WEBP" });
assert.equal(single.reference, "John 3:16");
assert.equal(single.passageText, "For God so loved the world.");
assert.equal(single.verseStart, 16);
assert.equal(single.verseEnd, 16);

const range = await resolveLocalScripture(client, { reference: "John 3:16-18", version: "webp" });
assert.equal(range.reference, "John 3:16-18");
assert.equal(range.passageText, verses.slice(0, 3).map((item) => item.text).join(" "));

const psalm = await resolveLocalScripture(client, { reference: "Psalm 23", version: "WEBP" });
assert.equal(psalm.book, "Psalms", "singular Psalm input must resolve the canonical Psalms book");
assert.equal(psalm.bookCode, "PSA");
assert.equal(psalm.reference, "Psalms 23");
assert.equal(psalm.verseStart, null);
assert.equal(psalm.verseEnd, null);
assert.equal(psalm.passageText.split(" ").length > 6, true);

async function expectCode(reference, version, code) {
  await assert.rejects(
    () => resolveLocalScripture(client, { reference, version }),
    (error) => error instanceof BibleLibraryError && error.code === code
  );
}

await expectCode("John 3:0", "WEBP", "scripture_reference_invalid");
await expectCode("John 3:18-16", "WEBP", "scripture_reference_invalid");
await expectCode("John 3:1-81", "WEBP", "scripture_reference_invalid");
await expectCode("John 3:16", "MISSING", "scripture_version_unavailable");
await expectCode("Obadiah 1:1", "WEBP", "scripture_book_not_found");

console.log(JSON.stringify({
  ok: true,
  versions: listedVersions.length,
  books: listedBooks.length,
  john3Verses: john3.length,
  psalmAlias: true,
  safetyRangeCap: 80
}));
