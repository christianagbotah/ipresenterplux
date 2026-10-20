#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const helperPath = path.join(root, "src/lib/public-audience-video-state.ts");
assert.ok(existsSync(helperPath), "public audience video-state helper must exist");

const { derivePublicAudienceVideoState } = await import("../src/lib/public-audience-video-state.ts");

assert.equal(derivePublicAudienceVideoState(null), "offline", "no stream session must be offline");
assert.equal(derivePublicAudienceVideoState({ status: "starting", router_ready_at: null }), "connecting", "starting stream must be connecting");
assert.equal(derivePublicAudienceVideoState({ status: "live", router_ready_at: null }), "connecting", "live session without router readiness must still be connecting");
assert.equal(derivePublicAudienceVideoState({ status: "live", router_ready_at: "2026-10-20T20:00:00Z" }), "live", "router-ready live session must be live");
assert.equal(derivePublicAudienceVideoState({ status: "stopping", router_ready_at: "2026-10-20T20:00:00Z" }), "offline", "stopping stream must no longer be presented as live");

const component = readFileSync(path.join(root, "src/components/audience/LiveProgramVideo.tsx"), "utf8");
assert.match(component, /videoStatus/u, "LiveProgramVideo must receive authoritative video status");
assert.match(component, /Video feed not started yet/u, "offline video must use a calm waiting state");
assert.match(component, /Connecting to live video/u, "starting video must use a connecting state");
assert.match(component, /videoStatus === "live"/u, "WebRTC/HLS presentation must be gated by live video status");

const page = readFileSync(path.join(root, "src/app/live/page.tsx"), "utf8");
assert.match(page, /videoStatus=\{audience\.video\.status\}/u, "public live page must pass authoritative video status to Audience UI");

console.log(JSON.stringify({ ok: true, states: ["offline", "connecting", "live"], playerGated: true }));
