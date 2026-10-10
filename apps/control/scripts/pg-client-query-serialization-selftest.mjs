import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function extractFunction(source, name) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  let parameterDepth = 0;
  let sawParameters = false;
  let braceStart = -1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "(") { parameterDepth += 1; sawParameters = true; }
    else if (source[index] === ")") parameterDepth -= 1;
    else if (source[index] === "{" && sawParameters && parameterDepth === 0) { braceStart = index; break; }
  }
  assert.notEqual(braceStart, -1, `${name} must have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, index + 1);
    }
  }
  throw new Error(`Could not parse ${name}`);
}

const currentServiceSource = await readFile(new URL("../src/lib/current-service.ts", import.meta.url), "utf8");
const aiDirectorSource = await readFile(new URL("../src/lib/ai-director.ts", import.meta.url), "utf8");

for (const [name, body] of [
  ["getCurrentServiceForUser", extractFunction(currentServiceSource, "getCurrentServiceForUser")],
  ["getAIDirectorState", extractFunction(aiDirectorSource, "getAIDirectorState")]
]) {
  assert.equal(
    body.includes("Promise.all("),
    false,
    `${name} must serialize work on its single PoolClient; concurrent client.query() calls are deprecated by pg and will fail under pg@9`
  );
}

console.log("pg_client_query_serialization_selftest:pass");
