import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/licensing/product-keys.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const {
  generateProductKey,
  normalizeProductKey,
  deriveProductKeyHash,
  verifyProductKey
} = await import(moduleUrl);

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
assert.equal(alphabet.length, 32);

const randomCalls = [];
function deterministicRandom(size) {
  randomCalls.push(size);
  return Buffer.alloc(size, 0);
}
const generated = await generateProductKey(deterministicRandom);
assert.match(generated.displayKey, /^IPLX(?:-[A-HJ-NP-Z2-9]{4}){5}$/u);
assert.match(generated.normalized, /^IPLX[A-HJ-NP-Z2-9]{20}$/u);
assert.equal(generated.normalized, generated.displayKey.replaceAll("-", ""));
assert.equal(generated.prefix, generated.normalized.slice(0, 12));
assert.equal(generated.salt.length, 16);
assert.equal(generated.hash.length, 32);
assert.deepEqual(randomCalls, [20, 16], "generation must request independent key and 16-byte salt randomness");

assert.equal(
  normalizeProductKey("  iplx-abcd efgh-jkmn-pqrs tuvw  "),
  "IPLXABCDEFGHJKMNPQRSTUVW"
);
for (const malformed of [
  "AAAA-ABCD-EFGH-JKMN-PQRS-TUVW",
  "IPLX-ABCD-EFGH-JKMN-PQRS-TUV",
  "IPLX-ABCD-EFGH-JKMN-PQRS-TUVWX",
  "IPLX-ABCD-EFGH-JKMN-PQRS-TUV0",
  "IPLX-ABCD-EFGH-JKMN-PQRS-TUV!"
]) {
  assert.throws(() => normalizeProductKey(malformed), /invalid product key format/iu, malformed);
}

const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const hashA = await deriveProductKeyHash(generated.normalized, salt);
const hashB = await deriveProductKeyHash(generated.normalized, salt);
assert.equal(hashA.length, 32);
assert.deepEqual(hashA, hashB, "scrypt derivation must be deterministic for the same key and salt");
assert.equal(await verifyProductKey(generated.displayKey, salt, hashA), true);
const wrong = generated.displayKey.slice(0, -1) + (generated.displayKey.endsWith("A") ? "B" : "A");
assert.equal(await verifyProductKey(wrong, salt, hashA), false);
assert.equal(await verifyProductKey(generated.displayKey, salt, Buffer.alloc(31)), false, "unequal hash lengths must reject before comparison");

assert.match(source, /randomBytes/u, "generation must use cryptographic randomBytes by default");
assert.match(source, /timingSafeEqual/u, "verification must use constant-time comparison for equal-length hashes");
assert.match(source, /N:\s*32768/u, "scrypt N must be 32768");
assert.match(source, /r:\s*8/u, "scrypt r must be 8");
assert.match(source, /p:\s*1/u, "scrypt p must be 1");
assert.doesNotMatch(source, /console\.(?:log|info|debug)/u, "product keys must never be logged");

console.log(JSON.stringify({ ok: true, format: "IPLX-4x5", alphabetSize: alphabet.length, scryptBytes: 32, timingSafeCompare: true }));
