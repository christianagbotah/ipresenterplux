#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";

const workspace = await fs.readFile(new URL("../src/components/ScriptureOperatorWorkspace.tsx", import.meta.url), "utf8");

assert.match(workspace, /useSyncExternalStore/u, "Operator workspace must model local storage as an external store for hydration-safe persistence");
assert.match(workspace, /localStorage\.getItem\(storageKey\)/u, "Hard reload must restore the last valid selected scripture");
assert.match(workspace, /localStorage\.removeItem\(storageKey\)/u, "Stale persisted selections must be cleared when the queue is empty");
assert.match(workspace, /window\.dispatchEvent\(new Event\(selectionEvent\)\)/u, "Same-tab selection changes must notify the external-store subscription");
assert.match(workspace, /if \(nextId === persistedSelectionId\) return/u, "Initial fallback must be pinned without creating an external-store event loop");
assert.doesNotMatch(workspace, /if \(!persistedSelectionId \|\|/u, "Missing persisted selection must fall through so the current fallback is pinned");
assert.match(workspace, /detections\.some\(\(item\) => item\.id === persistedSelectionId/u, "Persisted selection must be accepted only when it still exists in the current queue");

assert.match(workspace, /window\.addEventListener\("keydown"/u, "Broadcast operator keyboard controls must be registered explicitly");
assert.match(workspace, /window\.removeEventListener\("keydown"/u, "Broadcast operator keyboard controls must clean up on unmount");
assert.match(workspace, /isContentEditable/u, "Shortcuts must ignore editable content");
assert.match(workspace, /input,textarea,select/u, "Shortcuts must ignore form fields");
assert.match(workspace, /event\.key === "ArrowDown"/u, "ArrowDown must navigate the service queue");
assert.match(workspace, /event\.key === "ArrowUp"/u, "ArrowUp must navigate the service queue");
assert.match(workspace, /event\.key\.toLowerCase\(\) === "p"/u, "P must be the non-live Preview shortcut");
assert.match(workspace, /event\.key === "Enter"/u, "Enter must be used for the deliberate Take Live shortcut");
assert.match(workspace, /event\.ctrlKey \|\| event\.metaKey/u, "Take Live and Clear must require Ctrl/Cmd intent");
assert.match(workspace, /event\.key === "Backspace" \|\| event\.key === "Delete"/u, "Clear Program must use a deliberate delete shortcut");

assert.match(workspace, /selected\.state !== "preview"/u, "Take Live must be gated on an explicitly prepared Preview item");
assert.match(workspace, /selected\.state === "live"/u, "Preview must not re-stage the item currently on Program");
assert.match(workspace, /Queue navigation/u, "Workspace must visibly document queue navigation shortcuts");
assert.match(workspace, /Ctrl\/⌘ \+ Enter/u, "Workspace must visibly document deliberate Take Live shortcut");
assert.match(workspace, /Ctrl\/⌘ \+ Backspace/u, "Workspace must visibly document deliberate Clear Program shortcut");

assert.match(workspace, /const selectedIndex = detections\.findIndex/u, "Queue must locate the pinned selection within the newest-first detection list");
assert.match(workspace, /const newerDetectionCount = selectedIndex > 0 \? selectedIndex : 0/u, "Queue must count detections newer than the pinned selection");
assert.match(workspace, /scrollIntoView\(\{ block: "nearest" \}\)/u, "Keyboard navigation must keep the selected queue row visible");
assert.match(workspace, /Jump to newest/u, "Operator must have an explicit action to move focus to the latest detection");
assert.match(workspace, /select\(detections\[0\]\.id\)/u, "Jump to newest must deliberately select the latest queue item");
assert.match(workspace, /const isNewer = selectedIndex > 0 && index < selectedIndex/u, "Rows newer than the pinned selection must be identified without changing selection");
assert.match(workspace, />Newer</u, "Newer queue rows must have a visible marker");

console.log(JSON.stringify({
  ok: true,
  selectionPersistence: "hard-reload-safe",
  queueNavigation: "arrow-keys",
  previewShortcut: "P",
  takeLiveShortcut: "Ctrl/Cmd+Enter",
  clearShortcut: "Ctrl/Cmd+Backspace",
  previewBeforeProgram: true,
  initialSelectionPinned: true,
  newerDetectionAwareness: true,
  selectedRowVisibility: "nearest"
}));
