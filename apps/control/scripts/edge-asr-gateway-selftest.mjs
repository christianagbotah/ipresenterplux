#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { forwardEdgeAsrRequest } from "../src/lib/edge-asr-gateway.ts";

const route = await readFile(new URL("../src/app/api/v1/edge/asr/transcribe/route.ts", import.meta.url), "utf8");
assert.match(route, /authenticateEdgeDevice/, "ASR gateway must require Edge device authentication");
assert.match(route, /forwardEdgeAsrRequest/, "ASR route must delegate bounded forwarding to the shared gateway");

const audio = new Uint8Array([1,2,3,4,5,6]);
let forwarded = null;
const request = new Request("https://control.example/api/v1/edge/asr/transcribe", {
  method: "POST",
  headers: {
    "content-type": "application/octet-stream",
    "x-ipresenter-sample-rate": "16000",
    "x-ipresenter-audio-format": "pcm_s16le_mono",
    "x-ipresenter-started-at": "2026-10-23T12:00:00Z",
    "x-ipresenter-service-id": "11111111-1111-4111-8111-111111111111"
  },
  body: audio
});
const response = await forwardEdgeAsrRequest(request, async (url, init) => {
  forwarded = { url: String(url), init };
  return new Response(JSON.stringify({ text: "John 3:16", language: "en", confidence: 0.99 }), {
    status: 200, headers: { "content-type": "application/json" }
  });
}, {
  IPRESENTERPLUX_ASR_INTERNAL_URL: "http://127.0.0.1:8765",
  IPRESENTERPLUX_ASR_INTERNAL_TOKEN: "server-only-secret"
});
assert.equal(response.status, 200);
assert.equal(forwarded.url, "http://127.0.0.1:8765/v1/transcribe");
assert.equal(forwarded.init.headers.Authorization, "Bearer server-only-secret");
assert.equal(forwarded.init.headers["X-IPresenter-Sample-Rate"], "16000");
assert.equal(forwarded.init.headers["X-IPresenter-Audio-Format"], "pcm_s16le_mono");
assert.equal((await new Response(forwarded.init.body).arrayBuffer()).byteLength, audio.byteLength);

const oversized = new Request("https://control.example/api/v1/edge/asr/transcribe", {
  method: "POST",
  headers: { "x-ipresenter-sample-rate": "16000", "x-ipresenter-audio-format": "pcm_s16le_mono" },
  body: new Uint8Array(1_000_001)
});
const rejected = await forwardEdgeAsrRequest(oversized, async () => { throw new Error("must not forward"); }, {
  IPRESENTERPLUX_ASR_INTERNAL_URL: "http://127.0.0.1:8765"
});
assert.equal(rejected.status, 413);

const invalidFormat = new Request("https://control.example/api/v1/edge/asr/transcribe", {
  method: "POST",
  headers: { "x-ipresenter-sample-rate": "16000", "x-ipresenter-audio-format": "mp3" },
  body: new Uint8Array([1,2])
});
assert.equal((await forwardEdgeAsrRequest(invalidFormat, fetch, { IPRESENTERPLUX_ASR_INTERNAL_URL: "http://127.0.0.1:8765" })).status, 400);

console.log(JSON.stringify({ ok: true, gateway: "authenticated-bounded-forwarding" }));
