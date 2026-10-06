import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/edge-operator-catalog.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const {
  parseOperatorScriptureReference,
  deterministicScriptureItemId,
  normalizeOperatorPresentationBody,
  extractOperatorPresentationFields,
} = await import(moduleUrl);

assert.deepEqual(parseOperatorScriptureReference("John 3:16"), {
  book: "John", chapter: 3, verseStart: 16, verseEnd: 16,
});
assert.deepEqual(parseOperatorScriptureReference("Psalm 23"), {
  book: "Psalm", chapter: 23, verseStart: null, verseEnd: null,
});
assert.deepEqual(parseOperatorScriptureReference("1 Corinthians 13:4-7"), {
  book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 7,
});
assert.equal(parseOperatorScriptureReference("John 3:1-81"), null, "verse ranges above 80 are rejected");
assert.equal(parseOperatorScriptureReference("John 0:16"), null);
assert.equal(parseOperatorScriptureReference("John 3:20-16"), null);
assert.equal(parseOperatorScriptureReference("John 3:abc"), null);

const firstId = deterministicScriptureItemId("KJV", "John", 3, 16, 16);
assert.equal(firstId, deterministicScriptureItemId("KJV", "John", 3, 16, 16));
assert.notEqual(firstId, deterministicScriptureItemId("NIV", "John", 3, 16, 16));
assert.match(firstId, /^local-scripture-[a-f0-9]{24}$/);

assert.equal(normalizeOperatorPresentationBody("  hello   world  "), "hello world");
assert.equal(normalizeOperatorPresentationBody("x".repeat(13000)).length, 12000);

assert.deepEqual(
  extractOperatorPresentationFields({
    body: "  Main   slide text ",
    footer: " Worship Team ",
    metadata: { artist: "  Lightworld Choir ", secret: { nested: true } },
  }),
  { body: "Main slide text", footer: "Worship Team", metadata: { artist: "Lightworld Choir" } },
);
assert.deepEqual(
  extractOperatorPresentationFields({ lines: ["Line one", "Line two"], subtitle: "Verse 1" }),
  { body: "Line one\nLine two", footer: "Verse 1", metadata: {} },
);
assert.deepEqual(extractOperatorPresentationFields(null), { body: "", footer: null, metadata: {} });

console.log("Edge operator catalog self-test passed.");

const catalogRoute = await readFile(new URL("../src/app/api/v1/edge/operator/catalog/route.ts", import.meta.url), "utf8");
assert.match(catalogRoute, /authenticateEdgeDevice\(request\)/);
assert.match(catalogRoute, /d\.organization_id=\$2/);
assert.match(catalogRoute, /s\.campus_id is not distinct from d\.campus_id/);
assert.match(catalogRoute, /limit 200/i);
assert.match(catalogRoute, /limit 32/i);

const scriptureRoute = await readFile(new URL("../src/app/api/v1/edge/operator/scripture/route.ts", import.meta.url), "utf8");
assert.match(scriptureRoute, /authenticateEdgeDevice\(request\)/);
assert.match(scriptureRoute, /d\.organization_id=\$2/);
assert.match(scriptureRoute, /s\.campus_id is not distinct from d\.campus_id/);
assert.match(scriptureRoute, /local_enabled=true/);
assert.match(scriptureRoute, /limit 81/i);

console.log("Edge operator route scoping self-test passed.");
