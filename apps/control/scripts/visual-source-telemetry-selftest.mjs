#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  sanitizeVisualSourceMetadata,
  visualCaptureStatusCopy,
  visualSourceKind
} from "../src/lib/visual-source-metadata.ts";
import * as sources from "../src/lib/camera-sources.ts";

assert.equal(typeof sources.listVisualSources, "function", "visual-source aware listing helper must exist");

const sanitized = sanitizeVisualSourceMetadata({
  captureStatus: "disconnected",
  width: "1920",
  height: "1080",
  fps: "30",
  previewActive: "true",
  programActive: "false",
  framesCaptured: "1204",
  droppedFrames: "3",
  errorCode: "device_removed",
  processName: "POWERPNT",
  displayPrimary: "true",
  windowTitle: "Private sermon notes — do not expose",
  path: "C:\\Users\\Pastor\\secret.pptx",
  token: "super-secret-token",
  nativeKey: "window:c:/secret|hwnd:abc123"
});
assert.deepEqual(sanitized, {
  captureStatus: "disconnected",
  width: 1920,
  height: 1080,
  fps: 30,
  previewActive: true,
  programActive: false,
  framesCaptured: 1204,
  droppedFrames: 3,
  errorCode: "device_removed",
  processName: "POWERPNT",
  displayPrimary: true
});
for (const forbidden of ["windowTitle", "path", "token", "nativeKey"]) {
  assert.equal(Object.hasOwn(sanitized, forbidden), false, `${forbidden} must not survive metadata sanitization`);
}

const malformed = sanitizeVisualSourceMetadata({
  captureStatus: "nonsense",
  width: "NaN",
  height: "-1",
  fps: "9999",
  previewActive: "maybe",
  programActive: "2",
  framesCaptured: "-50",
  droppedFrames: "Infinity",
  displayPrimary: "perhaps"
});
assert.deepEqual(malformed, {}, "malformed metadata must be ignored rather than propagated or throwing");

assert.equal(visualSourceKind("camera"), "camera");
assert.equal(visualSourceKind("video_input"), "camera");
assert.equal(visualSourceKind("video_capture"), "camera");
assert.equal(visualSourceKind("display"), "display");
assert.equal(visualSourceKind("window"), "window");
assert.equal(visualSourceKind("browser_capture"), null);

assert.equal(visualCaptureStatusCopy("available"), "Available");
assert.equal(visualCaptureStatusCopy("busy"), "In use by another app");
assert.equal(visualCaptureStatusCopy("permission_required"), "Permission required");
assert.equal(visualCaptureStatusCopy("disconnected"), "Disconnected");
assert.equal(visualCaptureStatusCopy("unsupported"), "Not supported on this device");
assert.equal(visualCaptureStatusCopy("error"), "Capture error");
assert.equal(visualCaptureStatusCopy(null), "Status unavailable");

const routeSource = await readFile(new URL("../src/app/api/v1/edge/media-source/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /sanitizeVisualSourceMetadata\(payload\.metadata\)/,
  "Edge media-source ingress must sanitize metadata before persistence");
assert.match(routeSource, /sourceType:\s*z\.enum\(\["camera",\s*"video_input",\s*"video_capture",\s*"display",\s*"window"\]\)/,
  "Edge media-source ingress must accept only known visual source types");

const cameraSource = await readFile(new URL("../src/lib/camera-sources.ts", import.meta.url), "utf8");
assert.match(cameraSource, /sanitizeVisualSourceMetadata/);
assert.match(cameraSource, /listVisualSources/);
assert.doesNotMatch(cameraSource, /metadata\s*:\s*row\.metadata/,
  "list helpers must not pass arbitrary persisted metadata through to the UI");


const now = new Date("2099-01-01T12:00:00.000Z");
const fakeClient = {
  async query(text) {
    if (text.includes("from user_organization_roles")) {
      return { rowCount: 1, rows: [{ role_id: "presenter_operator" }] };
    }
    if (text.includes("from edge_devices") && !text.includes("join")) {
      return {
        rowCount: 1,
        rows: [{ id: "edge-1", name: "Sanctuary Edge", platform: "windows", status: "active", last_seen_at: now.toISOString() }]
      };
    }
    if (text.includes("from media_sources ms")) {
      return {
        rowCount: 1,
        rows: [{
          id: "source-1",
          organization_id: "org-1",
          name: "Internal Window Storage Name",
          source_type: "window",
          source_status: "live",
          last_seen_at: now.toISOString(),
          metadata: {
            reportedName: "PowerPoint",
            captureStatus: "available",
            width: "1920",
            height: "1080",
            fps: "30",
            previewActive: "false",
            programActive: "true",
            framesCaptured: "500",
            droppedFrames: "2",
            processName: "POWERPNT",
            windowTitle: "Confidential Board Meeting",
            path: "C:\\Private\\board.pptx",
            token: "do-not-leak",
            nativeKey: "window:private|hwnd:feed"
          },
          public_config: { previewUrl: "https://edge.example.invalid/window-preview" },
          edge_device_id: "edge-1",
          edge_name: "Sanctuary Edge",
          edge_platform: "windows",
          edge_status: "active",
          edge_last_seen_at: now.toISOString(),
          operator_label: null,
          preferred: null
        }]
      };
    }
    throw new Error(`Unexpected fake query: ${text}`);
  }
};
const projected = await sources.listVisualSources(fakeClient, "user-1", "org-1", { now });
assert.equal(projected.sources.length, 1);
const projectedWindow = projected.sources[0];
assert.equal(projectedWindow.name, "PowerPoint");
assert.equal(projectedWindow.kind, "window");
assert.equal(projectedWindow.captureStatus, "available");
assert.equal(projectedWindow.programActive, true);
assert.equal(projectedWindow.previewActive, false);
assert.equal(projectedWindow.processName, "POWERPNT");
assert.equal(projectedWindow.width, 1920);
assert.equal(projectedWindow.previewUrl, "https://edge.example.invalid/window-preview");
assert.equal(Object.hasOwn(projectedWindow, "metadata"), false);
const projectedJson = JSON.stringify(projectedWindow);
for (const privateValue of ["Confidential Board Meeting", "C:\\Private\\board.pptx", "do-not-leak", "window:private|hwnd:feed"]) {
  assert.equal(projectedJson.includes(privateValue), false, `projection leaked private value: ${privateValue}`);
}

console.log(JSON.stringify({
  ok: true,
  sourceKinds: ["camera", "display", "window"],
  sensitiveMetadataHidden: true,
  malformedMetadataIgnored: true,
  operatorCaptureStatusCopy: true
}));
