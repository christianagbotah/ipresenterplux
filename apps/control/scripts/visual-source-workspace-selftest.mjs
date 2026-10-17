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

const actions = await readFile(new URL("../src/lib/visual-source-actions.ts", import.meta.url), "utf8");
const cameraSources = await readFile(new URL("../src/lib/camera-sources.ts", import.meta.url), "utf8");
for (const command of ["visual.rescan", "visual.preview.select", "visual.preview.clear"]) {
  assert.ok(actions.includes(command), `visual action client must map '${command}' exactly`);
}
assert.match(actions, /edgeDeviceId/);
assert.match(actions, /serviceId/);
assert.match(actions, /sourceId/);
assert.doesNotMatch(actions, /program\.take|program\.show/);
assert.match(cameraSources, /sourceKey/, "visual listing must expose the stable non-native Edge source id needed by Preview selection");
assert.match(workspace, /requestVisualAction/);
assert.match(workspace, /canLiveControl/);
assert.match(workspace, /Preparing|Requested|Requesting/);
assert.match(workspace, /Rescan sources/);
assert.match(workspace, /Clear Preview/);
assert.match(workspace, /source\.sourceKey/);
assert.match(workspace, /busyDevice/);

assert.match(workspace, /useRouter/);
assert.match(workspace, /EventSource/);
assert.match(workspace, /\/api\/v1\/events\?serviceId=/);
assert.match(workspace, /router\.refresh\(\)/);
assert.match(workspace, /const sources = initialSources/);
assert.doesNotMatch(workspace, /useState\(initialSources\)|setSources\(/, "Edge/server source truth must not be duplicated into sync-on-effect client state");
assert.match(workspace, /setTimeout[\s\S]*15_000/, "requested state must expire if Edge never confirms it");
assert.match(workspace, /setInterval\(refresh, 5_000\)/);
assert.match(workspace, /activeServiceId/);
assert.match(workspace, /source\.reportingDevice\.activeServiceId === serviceId/);
assert.match(workspace, /device\.activeServiceId === serviceId/);

const workflow = await readFile(new URL("../../../.github/workflows/control-ci.yml", import.meta.url), "utf8");
assert.match(workflow, /test:visual-source-workspace/, "Control Portal CI must run the Visual Sources workspace contract");
