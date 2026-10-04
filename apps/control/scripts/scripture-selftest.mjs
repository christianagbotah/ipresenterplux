import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/scripture.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { detectContextualScriptureIntent, detectScriptureReferences, hasExplicitScriptureAttempt } = await import(moduleUrl);

const references = [
  ["John chapter three verse sixteen", "John 3:16"],
  ["Romans eight twenty-eight through thirty", "Romans 8:28-30"],
  ["First Corinthians thirteen four through seven", "1 Corinthians 13:4-7"],
  ["Psalm one hundred and nineteen verse one hundred and five", "Psalm 119:105"],
  ["Second Timothy chapter three verse sixteen", "2 Timothy 3:16"],
  ["John 3:16", "John 3:16"],
  ["John 3:16.", "John 3:16"],
  ["John 3:16 through 20.", "John 3:16-20"],
  ["Romans eight verse twenty  eight", "Romans 8:28"],
];

for (const [spoken, expected] of references) {
  const detected = detectScriptureReferences(spoken);
  assert.equal(detected.length, 1, `Expected one reference for: ${spoken}`);
  assert.equal(detected[0].reference, expected, spoken);
}

assert.deepEqual(detectContextualScriptureIntent("next verse"), { kind: "nextVerse" });
assert.deepEqual(detectContextualScriptureIntent("previous verse"), { kind: "previousVerse" });
assert.deepEqual(detectContextualScriptureIntent("verse seventeen"), { kind: "verse", verseStart: 17 });
assert.deepEqual(detectContextualScriptureIntent("verses seventeen to twenty"), { kind: "verse", verseStart: 17, verseEnd: 20 });
assert.deepEqual(detectContextualScriptureIntent("continue to verse twenty"), { kind: "continue", verseEnd: 20 });
assert.deepEqual(detectContextualScriptureIntent("next chapter"), { kind: "nextChapter" });
assert.equal(detectContextualScriptureIntent("we continue with the sermon"), null);
assert.equal(detectContextualScriptureIntent("verses seventeen through 1000"), null);
assert.equal(detectContextualScriptureIntent("verse seventeen to -1"), null);
assert.equal(detectContextualScriptureIntent("verse seventeen to nonsense"), null);
assert.equal(detectContextualScriptureIntent("verse seventeen through"), null);
assert.equal(detectContextualScriptureIntent("verses 16 to +20"), null);
assert.equal(detectContextualScriptureIntent("verse 16.5 to 20"), null);
assert.equal(detectContextualScriptureIntent("verses sixteen to twenty thousand"), null);
assert.equal(detectContextualScriptureIntent("continue to verse 20 through 1000"), null);
assert.equal(detectContextualScriptureIntent("continue to verse 20-1000"), null);
assert.equal(detectContextualScriptureIntent("verse 16 to 20 to 1000"), null);

assert.equal(detectScriptureReferences("John chapter zero verse sixteen").length, 0);
assert.equal(detectScriptureReferences("John 3:1000").length, 0);
assert.equal(detectScriptureReferences("John 3:16 through 1000").length, 0);
assert.equal(detectScriptureReferences("John 3:16 to -1").length, 0);
assert.equal(detectScriptureReferences("John 3:16 to +20").length, 0);
assert.equal(detectScriptureReferences("John 3:16.5 to 20").length, 0);
assert.equal(detectScriptureReferences("John 3:16 to twenty thousand").length, 0);
assert.equal(detectScriptureReferences("John 3:16-20 through 1000").length, 0);
assert.equal(detectScriptureReferences("John 3:16 through 20.5").length, 0);
assert.equal(hasExplicitScriptureAttempt("John chapter zero verse sixteen"), true);
assert.equal(hasExplicitScriptureAttempt("please show the next verse"), false);
assert.equal(hasExplicitScriptureAttempt("John zero verse sixteen"), true);
assert.equal(hasExplicitScriptureAttempt("John -1 verse sixteen"), true);
assert.equal(hasExplicitScriptureAttempt("John 1000 verse sixteen"), true);
assert.equal(hasExplicitScriptureAttempt("John negative one verse sixteen"), true);
const repeated = detectScriptureReferences("John 3:16, Romans 8:28, John 3:16");
assert.deepEqual(repeated.map((item) => item.reference), ["John 3:16", "Romans 8:28", "John 3:16"]);

console.log(`Scripture parser self-test passed (${references.length} spoken references + contextual commands).`);
