#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const files = {
  contracts: "../../edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorContracts.cs",
  handler: "../../edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorCommandHandler.cs",
  preparation: "../../edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaPreparationCoordinator.cs",
  catalog: "../../edge-agent/src/iPresenterPlux.Edge.Desktop/OperatorWorkspaceCatalog.cs",
  desktop: "../../edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs",
  renderer: "../../edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs",
  windowsAudio: "../../edge-agent/src/iPresenterPlux.Edge.Windows/WindowsMediaFoundationMediaAudioFrameProvider.cs",
  macAudio: "../../edge-agent/src/iPresenterPlux.Edge.MacOS/MacOSMediaAudioFrameProvider.cs",
  macBridge: "../../edge-agent/native/macos/iPresenterPlux.MediaBridge/Sources/iPresenterPluxMediaBridge/MediaBridge.swift",
  fieldUat: "../../../docs/qa/edge-media-playback-field-uat.md"
};
for (const relative of Object.values(files)) await access(new URL(relative, import.meta.url));
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), "utf8")])));

assert.match(source.contracts, /LocalOperatorMediaPreparation/);
assert.match(source.contracts, /MediaPreparations/);
assert.doesNotMatch(source.contracts, /LocalOperatorMediaPreparation[\s\S]{0,300}(LocalPath|PreparedMediaAsset)/, "operator readiness transport must not expose cache paths/assets");
assert.match(source.preparation, /GetSnapshots\(\)/);
assert.match(source.handler, /MediaPreparations/);
for (const badge of ["DOWNLOADING", "READY", "ERROR", "LIVE", "PAUSED", "ENDED"]) assert.ok(source.catalog.includes(badge), `missing operator media badge ${badge}`);
assert.match(source.catalog, /CanTakePreview/);
assert.match(source.desktop, /OperatorWorkspaceCatalog\.CanTakePreview/);
assert.match(source.renderer, /\/api\/media-assets\//);
assert.match(source.windowsAudio, /IMediaAudioFrameProvider/);
assert.match(source.macAudio, /IMediaAudioFrameProvider/);
assert.match(source.macBridge, /bridgeApiVersion[\s\S]{0,120}\b5\b/);
assert.doesNotMatch(source.desktop, /https:\/\/[^\s\"']+.*preview\.prepare_item/i, "desktop must not provide a remote media URL to Preview");
for (const token of ["windows", "macos", "offline", "projector", "contribution", "restart", "250 ms", "120 ms"]) assert.ok(source.fieldUat.toLowerCase().includes(token.toLowerCase()), `field UAT must document ${token}`);
console.log(JSON.stringify({ ok: true, safeReadinessTransport: true, authoritativeBadges: true, takeGate: true, localAssetPlayback: true, windowsMediaAudio: true, macosMediaAudio: true, twoPlatformFieldGate: true }));
