import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

process.loadEnvFile?.(".env.local");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const sourceFile = path.resolve("../../data/bibles/webp/engwebp_vpl.txt");
await fsPromises.access(sourceFile);

const EXPECTED_VERSE_COUNT = 31_103;

const books = [
  ["GEN","Genesis","OT"],["EXO","Exodus","OT"],["LEV","Leviticus","OT"],["NUM","Numbers","OT"],
  ["DEU","Deuteronomy","OT"],["JOS","Joshua","OT"],["JDG","Judges","OT"],["RUT","Ruth","OT"],
  ["1SA","1 Samuel","OT"],["2SA","2 Samuel","OT"],["1KI","1 Kings","OT"],["2KI","2 Kings","OT"],
  ["1CH","1 Chronicles","OT"],["2CH","2 Chronicles","OT"],["EZR","Ezra","OT"],["NEH","Nehemiah","OT"],
  ["EST","Esther","OT"],["JOB","Job","OT"],["PSA","Psalms","OT"],["PRO","Proverbs","OT"],
  ["ECC","Ecclesiastes","OT"],["SOL","Song of Solomon","OT"],["ISA","Isaiah","OT"],["JER","Jeremiah","OT"],
  ["LAM","Lamentations","OT"],["EZE","Ezekiel","OT"],["DAN","Daniel","OT"],["HOS","Hosea","OT"],
  ["JOE","Joel","OT"],["AMO","Amos","OT"],["OBA","Obadiah","OT"],["JON","Jonah","OT"],
  ["MIC","Micah","OT"],["NAH","Nahum","OT"],["HAB","Habakkuk","OT"],["ZEP","Zephaniah","OT"],
  ["HAG","Haggai","OT"],["ZEC","Zechariah","OT"],["MAL","Malachi","OT"],["MAT","Matthew","NT"],
  ["MAR","Mark","NT"],["LUK","Luke","NT"],["JOH","John","NT"],["ACT","Acts","NT"],
  ["ROM","Romans","NT"],["1CO","1 Corinthians","NT"],["2CO","2 Corinthians","NT"],["GAL","Galatians","NT"],
  ["EPH","Ephesians","NT"],["PHI","Philippians","NT"],["COL","Colossians","NT"],["1TH","1 Thessalonians","NT"],
  ["2TH","2 Thessalonians","NT"],["1TI","1 Timothy","NT"],["2TI","2 Timothy","NT"],["TIT","Titus","NT"],
  ["PHM","Philemon","NT"],["HEB","Hebrews","NT"],["JAM","James","NT"],["1PE","1 Peter","NT"],
  ["2PE","2 Peter","NT"],["1JO","1 John","NT"],["2JO","2 John","NT"],["3JO","3 John","NT"],
  ["JUD","Jude","NT"],["REV","Revelation","NT"]
];

const knownBookCodes = new Set(books.map(([code]) => code));

async function sha256File(filename) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function insertBatch(client, rows) {
  if (!rows.length) return;

  const values = [];
  const tuples = rows.map((row, index) => {
    const base = index * 5;
    values.push("WEBP", row.book, row.chapter, row.verse, row.text);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
  });

  await client.query(
    `insert into bible_verses(version_id,book_code,chapter,verse,text)
     values ${tuples.join(",")}
     on conflict (version_id,book_code,chapter,verse)
     do update set text=excluded.text`,
    values
  );
}

const checksum = await sha256File(sourceFile);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let verseCount = 0;

try {
  await client.query("begin");

  await client.query(
    `insert into bible_versions
      (id,name,abbreviation,language_code,license_kind,source_url,source_revision,content_sha256,local_enabled)
     values ('WEBP','World English Bible','WEBP','en','public_domain',
             'https://ebible.org/details.php?id=engwebp','2026-10-02',$1,true)
     on conflict (id) do update
     set name=excluded.name,
         abbreviation=excluded.abbreviation,
         language_code=excluded.language_code,
         license_kind=excluded.license_kind,
         source_url=excluded.source_url,
         source_revision=excluded.source_revision,
         content_sha256=excluded.content_sha256,
         local_enabled=true,
         updated_at=now()`,
    [checksum]
  );

  await client.query("delete from bible_books where version_id='WEBP'");

  for (let index = 0; index < books.length; index += 1) {
    const [code, name, testament] = books[index];
    await client.query(
      `insert into bible_books(version_id,book_code,canonical_name,book_order,testament)
       values ('WEBP',$1,$2,$3,$4)`,
      [code, name, index + 1, testament]
    );
  }

  const input = fs.createReadStream(sourceFile, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let batch = [];

  for await (const line of lines) {
    const match = /^(\S+)\s+(\d+):(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;

    if (!knownBookCodes.has(match[1])) {
      throw new Error(`Unexpected WEBP book code: ${match[1]}`);
    }

    batch.push({
      book: match[1],
      chapter: Number(match[2]),
      verse: Number(match[3]),
      text: match[4]
    });

    verseCount += 1;

    if (batch.length >= 400) {
      await insertBatch(client, batch);
      batch = [];
    }
  }

  await insertBatch(client, batch);

  if (verseCount !== EXPECTED_VERSE_COUNT) {
    throw new Error(`WEBP verse count mismatch: expected ${EXPECTED_VERSE_COUNT}, received ${verseCount}`);
  }

  await client.query("update services set active_bible_version=\'WEBP\', updated_at=now() where active_bible_version=\'KJV\'");
  await client.query("alter table services alter column active_bible_version set default \'WEBP\'");
  await client.query("alter table scripture_detections alter column bible_version set default \'WEBP\'");

  await client.query("commit");

  console.log(JSON.stringify({
    ok: true,
    version: "WEBP",
    books: books.length,
    verses: verseCount,
    sourceRevision: "2026-10-02",
    checksum
  }));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
