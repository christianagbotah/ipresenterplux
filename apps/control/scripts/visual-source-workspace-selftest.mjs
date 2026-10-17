#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/app/cameras/page.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../src/components/cameras/VisualSourcesWorkspace.tsx", import.meta.url), "utf8");

assert.match(page, /listVisualSources/);
assert.match(page, /VisualSourcesWorkspace/);
assert.doesNotMatch(page, /listCameraSources|CameraWorkspace/);

for (const copy of [
  "Visual Sources",
  "Cameras",
  "Screens",
  "Windows",
  "Reporting Edge",
  "Capture status",
  "Preview",
  "Program",
  "Manage Edge Devices"
]) {
  assert.ok(workspace.includes(copy), `Visual Sources workspace must surface '${copy}'`);
}

assert.match(workspace, /kind === "camera"/);
assert.match(workspace, /kind === "display"/);
assert.match(workspace, /kind === "window"/);
assert.match(workspace, /previewActive/);
assert.match(workspace, /programActive/);
assert.match(workspace, /captureStatusLabel/);
assert.match(workspace, /reportingDevice/);
assert.match(workspace, /break-words|truncate/);
assert.doesNotMatch(workspace, /text-\[(?:10|11)px\]/, "operational text must not drop below 12px");
assert.doesNotMatch(workspace, /getUserMedia|mediaDevices/, "browser capture must never be used by Visual Sources");
assert.doesNotMatch(workspace, /program\.take|program\.show|Go Live|TAKE/, "source cards must not promote content to Program");

const preferenceEndpointUses = [...workspace.matchAll(/\/api\/v1\/cameras\/preferences/g)].length;
assert.ok(preferenceEndpointUses >= 1, "camera preference editing must remain available");
assert.match(workspace, /source\.kind === "camera"/, "preference controls must be camera-only");

console.log(JSON.stringify({
  ok: true,
  title: "Visual Sources",
  categories: ["Cameras", "Screens", "Windows"],
  edgeConfirmedBadges: true,
  browserCaptureClaimed: false,
  livePromotionFromSourceCard: false
}));
