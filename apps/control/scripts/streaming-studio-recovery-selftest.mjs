#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const streaming = readFileSync(path.join(root, "src/app/streaming/page.tsx"), "utf8");
const heartbeat = readFileSync(path.join(root, "src/app/api/v1/edge/heartbeat/route.ts"), "utf8");
const video = readFileSync(path.join(root, "src/components/audience/LiveProgramVideo.tsx"), "utf8");

assert.match(streaming, /reconcileStaleStreamSession/u, "Streaming Studio must reconcile stale stream sessions before rendering truth");
assert.match(heartbeat, /reconcileStaleStreamSession/u, "authenticated Edge heartbeat must reconcile stale stream sessions");
assert.match(heartbeat, /stream\.session\.changed/u, "heartbeat recovery must publish stream session refresh after commit");
assert.match(streaming, /LiveProgramVideo/u, "Streaming Studio must render the real Program transport preview");
assert.match(streaming, /mode="operator"/u, "Streaming Studio must use operator preview mode");
assert.match(streaming, /120 seconds/u, "Streaming Studio must explain bounded transition recovery");
assert.match(streaming, /Program preview/u, "Streaming Studio must label the Program preview explicitly");
assert.match(video, /mode\?: "audience" \| "operator"/u, "Program video component must support operator mode without changing audience behavior");
assert.match(video, /transportStatus/u, "operator preview must show authoritative transport state");
assert.match(video, /\/media\/webrtc\/service\//u, "operator preview must use the same service Program transport as the audience");

console.log(JSON.stringify({ ok: true, heartbeatRecovery: true, pageRecovery: true, programPreview: true, timeoutSeconds: 120 }));
