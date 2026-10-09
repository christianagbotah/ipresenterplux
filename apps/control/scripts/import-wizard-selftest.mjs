#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const mediaWorkspace = await source("../src/components/media/MediaWorkspace.tsx");
const importPage = await source("../src/app/media/import/page.tsx");
const wizard = await source("../src/components/imports/ImportWizard.tsx");
const libraryExport = await source("../src/app/api/v1/exports/library/route.ts");
const serviceExport = await source("../src/app/api/v1/exports/services/[id]/route.ts");

assert.match(mediaWorkspace, /href=["']\/media\/import["']/u, "Songs & Media must expose the migration wizard");
assert.match(mediaWorkspace, /Import existing content/i);

assert.match(importPage, /auth\(\)/u, "migration wizard page must require the existing authenticated session");
assert.match(importPage, /ImportWizard/u);
assert.match(importPage, /organizationId/u);

assert.match(wizard, /type=["']file["']/u, "wizard must support file upload");
assert.match(wizard, /textarea/u, "wizard must support paste input");
for (const kind of ["song_text", "song_csv", "service_rundown_json", "media_url_manifest"]) {
  assert.match(wizard, new RegExp(kind), `${kind} must be selectable in the wizard`);
}
assert.match(wizard, /\/api\/v1\/imports\/preview/u);
assert.match(wizard, /\/api\/v1\/imports\/commit/u);
assert.match(wizard, /previewAccepted|canCommit/u, "commit must be explicitly gated by an accepted preview");
assert.match(wizard, /skip/u);
assert.match(wizard, /import_copy/u);
for (const status of ["valid", "warning", "error", "duplicate"]) {
  assert.match(wizard, new RegExp(status), `wizard must present ${status} preview rows`);
}
assert.match(wizard, /documented portable export/i, "unsupported proprietary formats need truthful migration guidance");
assert.match(wizard, /EasyWorship|ProPresenter|vMix|OBS/u, "wizard should explain the migration boundary in familiar product language");
assert.match(wizard, /batchId/u, "commit result must retain batch identity");
assert.match(wizard, /\/api\/v1\/imports\/\$\{[^}]+\}\/undo/u, "wizard must expose batch undo");
assert.match(wizard, /created/u);
assert.match(wizard, /skipped/u);

for (const [name, route] of [["library", libraryExport], ["service", serviceExport]]) {
  assert.match(route, /auth\(\)/u, `${name} export must require authentication`);
  assert.match(route, /format/u, `${name} export must expose a portable format choice`);
  assert.match(route, /Content-Disposition/u, `${name} export should download a portable file`);
  assert.doesNotMatch(route, /credential_hash|activation_token|product_key_hash|refresh_token|access_token|encrypted_secret|private_key/iu, `${name} export source must not select or emit secrets`);
}
assert.match(libraryExport, /listMediaLibrary/u, "library export must reuse tenant-aware Media Library reads");
assert.match(serviceExport, /loadPlannerServiceDetail/u, "service export must reuse tenant-aware Planner reads");
assert.match(libraryExport, /text\/csv|application\/json/u);
assert.match(serviceExport, /text\/csv|application\/json/u);

console.log(JSON.stringify({
  ok: true,
  entryPoint: "/media/import",
  uploadAndPaste: true,
  previewBeforeCommit: true,
  duplicateChoice: ["skip", "import_copy"],
  previewStatuses: ["valid", "warning", "error", "duplicate"],
  undoVisible: true,
  proprietaryGuidance: true,
  portableExports: ["library", "service"],
  secretsExported: false
}));
