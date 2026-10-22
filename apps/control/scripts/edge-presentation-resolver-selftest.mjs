import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const resolverUrl = new URL("../src/lib/edge-presentation-resolver.ts", import.meta.url);
let resolverSource = null;
try { resolverSource = await readFile(resolverUrl, "utf8"); } catch {}
assert.ok(resolverSource, "edge presentation resolver must exist");

const javascript = ts.transpileModule(resolverSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const resolver = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const { resolveEdgePresentationItem, EdgePresentationResolverError, presentationThemeContentVariant } = resolver;
assert.equal(typeof resolveEdgePresentationItem, "function", "resolveEdgePresentationItem must be exported");
assert.equal(typeof presentationThemeContentVariant, "function", "presentationThemeContentVariant must be exported");
assert.equal(presentationThemeContentVariant("scripture"), "scripture");
assert.equal(presentationThemeContentVariant("song"), "song");
assert.equal(presentationThemeContentVariant("announcement"), "announcement");
assert.equal(presentationThemeContentVariant("media"), "generic");

const deviceId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const serviceId = "44444444-4444-4444-8444-444444444444";
const sourceId = "55555555-5555-4555-8555-555555555555";

function fakeClient(handler) {
  return { query: async (sql, values = []) => ({ rows: await handler(String(sql), values) }) };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    throw error;
  }
}

await run("resolves_media_descriptor_from_active_service_item", async () => {
  const client = fakeClient((sql) => {
    if (sql.includes("edge_presentation_item")) return [{
      item_id: itemId, service_id: serviceId, item_type: "media", title: "Worship opener",
      content: { sourceId, mediaKind: "video", body: "", footer: null }
    }];
    if (sql.includes("edge_media_source")) return [{
      id: sourceId, name: "Worship master", source_type: "media_file", status: "ready",
      public_config: { assetUrl: "https://media.example.test/worship.mp4", mediaKind: "video", contentType: "video/mp4", secret: "never-expose" }
    }];
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
  const result = await resolveEdgePresentationItem(client, { deviceId, organizationId, itemId });
  assert.equal(result.itemId, itemId);
  assert.equal(result.serviceId, serviceId);
  assert.equal(result.itemType, "media");
  assert.deepEqual(result.media, {
    sourceId,
    mediaKind: "video",
    downloadUrl: "https://media.example.test/worship.mp4",
    assetVersion: result.media.assetVersion,
    contentTypeHint: "video/mp4",
    title: "Worship opener",
    trimStartSeconds: 0,
    trimEndSeconds: null,
    loop: false,
    volume: 1,
    fit: "contain"
  });
  assert.match(result.media.assetVersion, /^[a-f0-9]{32,64}$/);
  assert.equal("public_config" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /never-expose|public_config/);
});

await run("rejects_cross_tenant_or_wrong_service_item_without_leak", async () => {
  const seen = [];
  const client = fakeClient((sql, values) => {
    seen.push({ sql, values });
    if (sql.includes("edge_presentation_item")) return [];
    if (sql.includes("edge_legacy_scripture")) return [];
    throw new Error("media source must not be queried for unavailable item");
  });
  const result = await resolveEdgePresentationItem(client, { deviceId, organizationId, itemId });
  assert.equal(result, null);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(({ values }) => values.includes(deviceId) && values.includes(organizationId)));
});

await run("rejects_unsafe_media_source_url", async () => {
  const client = fakeClient((sql) => {
    if (sql.includes("edge_presentation_item")) return [{
      item_id: itemId, service_id: serviceId, item_type: "media", title: "Unsafe",
      content: { sourceId, mediaKind: "video" }
    }];
    if (sql.includes("edge_media_source")) return [{
      id: sourceId, name: "Unsafe", source_type: "media_file", status: "ready",
      public_config: { assetUrl: "javascript:alert(1)", mediaKind: "video" }
    }];
    return [];
  });
  await assert.rejects(
    () => resolveEdgePresentationItem(client, { deviceId, organizationId, itemId }),
    (error) => error instanceof EdgePresentationResolverError && error.code === "media_source_unsafe"
  );
});

await run("normalizes_media_trim_loop_volume_and_fit", async () => {
  const client = fakeClient((sql) => {
    if (sql.includes("edge_presentation_item")) return [{
      item_id: itemId, service_id: serviceId, item_type: "media", title: "Trimmed",
      content: { sourceId, mediaKind: "audio", trimStartSeconds: 3.5, trimEndSeconds: 14.25, loop: true, volume: 1.8, fit: "unsupported" }
    }];
    if (sql.includes("edge_media_source")) return [{
      id: sourceId, name: "Audio", source_type: "media_file", status: "ready",
      public_config: { assetUrl: "https://media.example.test/song.m4a", mediaKind: "audio" }
    }];
    return [];
  });
  const result = await resolveEdgePresentationItem(client, { deviceId, organizationId, itemId });
  assert.equal(result.media.trimStartSeconds, 3.5);
  assert.equal(result.media.trimEndSeconds, 14.25);
  assert.equal(result.media.loop, true);
  assert.equal(result.media.volume, 1);
  assert.equal(result.media.fit, "contain");
});

await run("keeps_legacy_scripture_detection_fallback", async () => {
  const legacyId = "66666666-6666-4666-8666-666666666666";
  const client = fakeClient((sql) => {
    if (sql.includes("edge_presentation_item")) return [];
    if (sql.includes("edge_legacy_scripture")) return [{
      item_id: legacyId, service_id: serviceId, scripture_reference: "John 3:16", bible_version: "KJV",
      book: "John", chapter: 3, verse_start: 16, verse_end: 16, source_text: "Fallback", passage_text: "For God so loved the world"
    }];
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
  const result = await resolveEdgePresentationItem(client, { deviceId, organizationId, itemId: legacyId });
  assert.equal(result.itemType, "scripture");
  assert.equal(result.title, "John 3:16");
  assert.equal(result.body, "For God so loved the world");
  assert.equal(result.footer, "KJV");
  assert.equal(result.media, null);
  assert.deepEqual(result.metadata, { book: "John", chapter: "3", verses: "16", bibleVersion: "KJV" });
});

console.log("edge presentation resolver self-test passed");
