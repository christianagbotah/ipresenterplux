#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  header: await readFile(new URL("../src/components/cockpit/CockpitHeader.tsx", import.meta.url), "utf8"),
  scripture: await readFile(new URL("../src/app/scripture/page.tsx", import.meta.url), "utf8"),
  visualSources: await readFile(new URL("../src/components/cameras/VisualSourcesWorkspace.tsx", import.meta.url), "utf8"),
  command: await readFile(new URL("../src/components/cockpit/CommandPalette.tsx", import.meta.url), "utf8"),
};

function expectFocus(source, label, needle) {
  const line = source.split("\n").find((candidate) => candidate.includes(needle));
  assert.ok(line, `${label} control must exist`);
  assert.match(line, /ip-focus-gold|focus-visible:/, `${label} must expose an explicit visible keyboard focus treatment`);
}

expectFocus(files.header, "Cockpit workspace link", "domainLinks.map");
expectFocus(files.scripture, "Scripture Operator link", 'href="/operator"');
expectFocus(files.visualSources, "Visual Sources Manage Edge Devices", 'href="/settings/devices"');
expectFocus(files.visualSources, "Visual Sources Rescan", '"Rescan sources"');
expectFocus(files.visualSources, "Visual Sources Clear Preview", '"Clear Preview"');
expectFocus(files.visualSources, "Visual Sources Preview", 'runVisualAction(source.reportingDevice!.id, "preview", source)');
expectFocus(files.visualSources, "Visual Sources camera label action", '"Label"');
expectFocus(files.visualSources, "Visual Sources preferred action", "Make preferred");
expectFocus(files.command, "Command Run", 'pending ? "Working…" : "Run"');
expectFocus(files.command, "Command media result", 'kind === "media_search"');
expectFocus(files.command, "Command status result", 'kind === "status"');

console.log(JSON.stringify({ok:true,criticalKeyboardFocus:true,controls:11}));
