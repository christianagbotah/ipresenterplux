import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const consumers = [
  "src/app/DashboardPage.tsx",
  "src/app/operator/page.tsx",
  "src/app/scripture/page.tsx",
  "src/lib/public-audience-service.ts",
  "src/app/api/v1/edge/presentation/items/[id]/route.ts",
  "src/lib/edge-operator-catalog-queries.ts"
];

const wholeChapterRange = /sd\.verse_start\s+is\s+null\s+or\s+bv\.verse\s+between\s+sd\.verse_start\s+and\s+coalesce\(sd\.verse_end,\s*sd\.verse_start\)/iu;
for (const relative of consumers) {
  const source = readFileSync(path.join(root, relative), "utf8");
  assert.match(
    source,
    wholeChapterRange,
    `${relative} must load the entire chapter when a Scripture detection has null verse bounds`
  );
}

const publicAudienceConsumers = [
  "src/app/live/page.tsx",
  "src/app/api/v1/audience/service/[id]/route.ts"
];
for (const relative of publicAudienceConsumers) {
  const source = readFileSync(path.join(root, relative), "utf8");
  assert.match(
    source,
    /loadPublicAudienceService/u,
    `${relative} must delegate public Scripture loading through the shared audience loader`
  );
}

console.log(JSON.stringify({ ok: true, wholeChapterConsumers: consumers.length, publicAudienceConsumers: publicAudienceConsumers.length, nullVerseBounds: "full-chapter" }));
