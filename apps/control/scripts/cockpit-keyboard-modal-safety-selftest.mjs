#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helper = await readFile(new URL("../src/lib/cockpit/keyboard-safety.ts", import.meta.url), "utf8").catch(() => "");
const stage = await readFile(new URL("../src/components/cockpit/ProgramPreviewStage.tsx", import.meta.url), "utf8");
const depth = await readFile(new URL("../src/components/cockpit/CockpitDepthControls.tsx", import.meta.url), "utf8");
const command = await readFile(new URL("../src/components/cockpit/CommandPalette.tsx", import.meta.url), "utf8");
const shortcuts = await readFile(new URL("../src/components/cockpit/ShortcutsHelp.tsx", import.meta.url), "utf8");
const attention = await readFile(new URL("../src/components/cockpit/AttentionLayer.tsx", import.meta.url), "utf8");

assert.match(helper, /export function hasBlockingModal/, "shared modal keyboard guard must exist");
assert.match(helper, /aria-modal=["']true["']|aria-modal\\?=\\?["']true["']|\[aria-modal=[^\]]+true[^\]]*\]/, "guard must detect aria-modal dialogs");
assert.match(stage, /hasBlockingModal\(\)/, "TAKE/Clear shortcuts must stop while a modal is open");
assert.match(depth, /hasBlockingModal\(\)/, "F/D/A shortcuts must stop while a modal is open");
assert.match(command, /hasBlockingModal\(\)/, "Command palette shortcut must not open under another modal");
assert.match(shortcuts, /hasBlockingModal\(\)/, "Shortcuts help must not open under another modal");
assert.doesNotMatch(shortcuts, /program\.show|state:\s*["']live["']|\/state[^\n]+live/, "Shortcuts help must never mutate Program");
assert.match(shortcuts, /autoFocus/, "Shortcuts modal must move initial keyboard focus inside the dialog");
assert.match(attention, /autoFocus/, "Attention modal must move initial keyboard focus inside the dialog");
assert.match(attention, /event\.key === ["']Escape["']/, "Attention modal must close on Escape");

console.log(JSON.stringify({ok:true,programShortcutBlockedByModal:true,viewShortcutsBlockedByModal:true,overlayStackingPrevented:true,modalInitialFocus:true,attentionEscapeClose:true}));
