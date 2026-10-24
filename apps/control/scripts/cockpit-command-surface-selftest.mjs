#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../../../.github/workflows/control-ci.yml", import.meta.url), "utf8");
assert.match(workflow, /test:cockpit-command-surface/, "Control Portal CI must run universal command surface contract");
const palette = await readFile(new URL("../src/components/cockpit/CommandPalette.tsx", import.meta.url), "utf8");
const header = await readFile(new URL("../src/components/cockpit/CockpitHeader.tsx", import.meta.url), "utf8");
const trigger = await readFile(new URL("../src/components/cockpit/UniversalFindTrigger.tsx", import.meta.url), "utf8");
const focus = await readFile(new URL("../src/components/cockpit/FocusMode.tsx", import.meta.url), "utf8");

for (const source of [palette, trigger, focus]) {
  assert.match(source, /What do you need next\?|Find \/ Command/, "universal find must be obvious from every live Cockpit surface");
}
assert.match(palette, /\/api\/v1\/cockpit\/search\?q=/, "typing must call the read-only grouped search endpoint");
assert.match(palette, /120/, "read-only search must debounce by 120ms");
for (const label of ["Scripture", "Songs", "Media", "Service", "Archive", "Visual Sources", "Actions"]) {
  assert.ok(palette.includes(label), `palette must know the ${label} result group`);
}
assert.match(palette, /ArrowDown/);
assert.match(palette, /ArrowUp/);
assert.match(palette, /event\.key === "Enter"|event\.key === 'Enter'/);
assert.match(palette, /event\.key === "Escape"|event\.key === 'Escape'/);
assert.match(palette, /activeIndex/);
assert.match(palette, /role="option"/);
assert.match(palette, /aria-activedescendant/);
assert.match(palette, /min-h-11|min-h-12|min-h-14/, "search results and triggers must preserve at least 44px touch targets");
assert.match(palette, /searchLoading/);
assert.match(palette, /searchError/);
assert.match(palette, /setActiveIndex/, "keyboard highlight must be local UI state");
assert.doesNotMatch(palette, /onMouseEnter=.*fetch|onPointerMove=.*fetch/, "highlighting a result must never mutate or execute it");
assert.match(palette, /\/api\/v1\/cockpit\/command/, "explicit command endpoint must remain present");
assert.match(palette, /method:\s*"POST"/, "consequential typed actions must remain explicit POST submissions");
assert.doesNotMatch(palette, /program\.show|program\.take|state:\s*["']live["']/, "universal find must not add direct Program mutation");
assert.match(header, /UniversalFindTrigger/);
assert.doesNotMatch(header, /["']use client["']/, "Cockpit header must remain a Server Component so auth/database code never enters the browser bundle");
assert.match(trigger, /ipresenterplux:command-open/);
assert.match(focus, /ipresenterplux:command-open/);

console.log(JSON.stringify({ok:true,label:"What do you need next?",groups:7,debounceMs:120,keyboardNavigation:true,touchFriendly:true,highlightReadOnly:true}));
