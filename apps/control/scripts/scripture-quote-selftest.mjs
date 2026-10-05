import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

async function transpiledDataUrl(path, replacements = []) {
  let source = await readFile(path, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

const scriptureUrl = await transpiledDataUrl(new URL("../src/lib/scripture.ts", import.meta.url));
const quoteUrl = await transpiledDataUrl(
  new URL("../src/lib/scripture-quote.ts", import.meta.url),
  [["@/lib/scripture", scriptureUrl]]
);
const { matchScriptureQuote } = await import(quoteUrl);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const john = await matchScriptureQuote(client, "WEBP", "For God so loved the world");
  assert.equal(john?.reference, "John 3:16");
  assert.equal(john?.detectionMethod, "quote");
  assert.ok((john?.confidence ?? 0) >= 90);

  const johnWithLeadIn = await matchScriptureQuote(
    client,
    "WEBP",
    "The Bible says for God so loved the world that he gave his one and only son"
  );
  assert.equal(johnWithLeadIn?.reference, "John 3:16");
  assert.ok((johnWithLeadIn?.confidence ?? 0) >= 90);

  const genesis = await matchScriptureQuote(
    client,
    "WEBP",
    "In the beginning God created the heavens and the earth"
  );
  assert.equal(genesis?.reference, "Genesis 1:1");

  const unrelated = await matchScriptureQuote(
    client,
    "WEBP",
    "Today we are talking about faith and patience in difficult times"
  );
  assert.equal(unrelated, null);

  const tooShort = await matchScriptureQuote(client, "WEBP", "God loved the world");
  assert.equal(tooShort, null);

  console.log("Scripture quote self-test passed (3 positive + 2 rejection cases).");
} finally {
  await client.query("rollback");
  await client.end();
}
