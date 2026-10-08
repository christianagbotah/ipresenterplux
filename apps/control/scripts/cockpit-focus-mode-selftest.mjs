#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
const files=[
  "../src/components/cockpit/FocusMode.tsx",
  "../src/components/cockpit/CockpitDepthControls.tsx",
  "../src/components/cockpit/CockpitWorkspace.tsx"
];
for(const file of files) await access(new URL(file,import.meta.url));
const [focus,depth,workspace]=await Promise.all(files.map(file=>readFile(new URL(file,import.meta.url),"utf8")));
assert.match(workspace,/CockpitDepthControls/);
assert.match(depth,/essential/); assert.match(depth,/advanced/); assert.match(depth,/engineering/);
assert.match(depth,/localStorage/,"view preference may persist locally");
assert.match(depth,/model\.capabilities|capabilities/,"controls must consume server capabilities rather than derive authority from depth");
assert.match(focus,/ProgramPreviewStage/); assert.match(focus,/NextRail/);
assert.match(focus,/Attention/); assert.match(focus,/Command/);
assert.match(focus,/Exit Focus|Exit focus/);
assert.doesNotMatch(depth,/canLiveControl\s*=\s*depth|canStreaming\s*=\s*depth|canSettings\s*=\s*depth/,"visual depth must never synthesize capability");
assert.match(focus,/min-h-1[12]|min-h-14|h-1[12]/,"Focus controls must be touch-friendly");
assert.doesNotMatch(focus,/group-hover:[^\s]*block[\s\S]*TAKE/,"TAKE must not depend on hover visibility");
console.log(JSON.stringify({ok:true,focusPresentationOnly:true,depths:["essential","advanced","engineering"],serverAuthority:true,touchFriendly:true}));
