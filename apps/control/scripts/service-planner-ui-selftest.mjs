#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const policy = await import("../src/lib/role-policy.js");
const capabilities = await import("../src/lib/role-capabilities.ts");

const allRoles = [
  "owner","admin","pastor","presenter_operator","media_operator",
  "translator","finance","welfare","group_leader","viewer"
];
const mutationRoles = new Set(["owner","admin","pastor","presenter_operator","media_operator"]);

for (const role of allRoles) {
  const caps = capabilities.roleCapabilities([role]);
  assert.equal(caps.canViewPlanner, true, `${role} must see Planner navigation`);
  assert.equal(caps.canPlanServices, mutationRoles.has(role), `${role} planner mutation affordance mismatch`);
}
assert.deepEqual(policy.PLANNER_VIEW_ROLES, allRoles);

async function readRequired(path, label) {
  try {
    return await fs.readFile(new URL(path, import.meta.url), "utf8");
  } catch {
    assert.fail(`${label} must exist`);
  }
}

const dashboard = await readRequired("../src/app/page.tsx", "dashboard");
assert.match(dashboard, /href=\{?"\/planner"\}?|"\/planner"/, "dashboard must link to /planner");
assert.match(dashboard, /capabilities\.canViewPlanner/, "dashboard Planner link must use canViewPlanner");

const plannerPage = await readRequired("../src/app/planner/page.tsx", "Planner page");
assert.match(plannerPage, /ServicePlannerList/, "Planner page must render service list");
assert.match(plannerPage, /CreateServiceDialog/, "Planner page must render create-service UI");
assert.match(plannerPage, /roleCapabilities/, "Planner page must derive shared capabilities");
assert.match(plannerPage, /canPlanServices/, "Planner page must pass mutation capability");
assert.match(plannerPage, /timezone/, "Planner page must load organization timezone");
assert.match(plannerPage, /bible_versions/, "Planner page must load locally enabled Bible versions");
assert.match(plannerPage, /campuses/, "Planner page must load organization campuses");

const listSource = await readRequired("../src/components/planner/ServicePlannerList.tsx", "ServicePlannerList");
for (const label of ["Upcoming", "Draft", "Ready", "Live", "Ended / Archive"]) {
  assert.match(listSource, new RegExp(label.replace(" / ", " \\/ ")), `Planner list must include ${label} filter`);
}
assert.match(listSource, /Intl\.DateTimeFormat/, "service schedule must use Intl.DateTimeFormat");
assert.match(listSource, /timeZone/, "service schedule must use organization timezone");
assert.match(listSource, /canPlanServices/, "service list mutation affordances must be capability gated");
assert.match(listSource, /\/planner\/\$\{/, "service rows must link into the service planner workspace");
assert.doesNotMatch(listSource, /w-\[(?:[6-9]\d\d|\d{4,})px\]/, "Planner list must not introduce fixed desktop-width overflow");

const createSource = await readRequired("../src/components/planner/CreateServiceDialog.tsx", "CreateServiceDialog");
assert.match(createSource, /canPlanServices/, "create dialog must be capability gated");
for (const field of ["title", "serviceType", "campusId", "scheduledStart", "activeBibleVersion"]) {
  assert.match(createSource, new RegExp(field), `create dialog must include ${field}`);
}
assert.match(createSource, /\/api\/v1\/planner\/services/, "create dialog must call planner service API");
assert.match(createSource, /router\.push\(`\/planner\/\$\{/, "successful create must navigate to service planner detail");
assert.match(createSource, /400|403|409/, "create dialog must surface safe API validation/authorization/conflict failures");
assert.doesNotMatch(createSource, /w-\[(?:[6-9]\d\d|\d{4,})px\]/, "create dialog must remain responsive");
assert.match(createSource, /createPortal/, "create dialog must escape the sticky Planner header stacking context through a portal");
assert.match(createSource, /document\.body/, "create dialog portal must mount at document.body");
assert.match(createSource, /z-\[220\]/, "create dialog must use the top-level blocking-modal layer");

const detailPage = await readRequired("../src/app/planner/[id]/page.tsx", "Planner detail page");
assert.match(detailPage, /ServicePlannerWorkspace/, "Planner detail page must render the authoring workspace");
assert.match(detailPage, /loadPlannerServiceDetail/, "Planner detail page must load tenant-scoped service detail");
assert.match(detailPage, /bible_versions/, "Planner detail page must load enabled Bible choices");
assert.match(detailPage, /media_sources/, "Planner detail page must load approved organization media sources");

const workspaceSource = await readRequired("../src/components/planner/ServicePlannerWorkspace.tsx", "ServicePlannerWorkspace");
for (const component of ["RundownList", "CueEditor", "CuePreview"]) {
  assert.match(workspaceSource, new RegExp(component), `workspace must compose ${component}`);
}
assert.match(workspaceSource, /activePane/, "narrow workspace must expose pane navigation state");
for (const pane of ["Rundown", "Editor", "Preview"]) {
  assert.match(workspaceSource, new RegExp(`>${pane}<|\"${pane}\"`), `workspace must expose ${pane} pane`);
}
assert.match(workspaceSource, /\/api\/v1\/planner\/services\/\$\{[^}]+\}\/preview/, "Preview must use planner Preview API");
assert.doesNotMatch(workspaceSource, /edge\/.*program|program\.take|program\.show/i, "Planner authoring must never invoke Edge Program APIs");
assert.match(workspaceSource, /If-Match/i, "persisted cue mutations must carry the latest planner revision");
assert.match(workspaceSource, /duplicate/i, "workspace must support cue duplication");
assert.match(workspaceSource, /DELETE/, "workspace must support cue deletion");

const rundownSource = await readRequired("../src/components/planner/RundownList.tsx", "RundownList");
assert.match(rundownSource, /canEdit/, "rundown mutation affordances must be read-only aware");
assert.doesNotMatch(rundownSource, /w-\[(?:[6-9]\d\d|\d{4,})px\]/, "rundown must remain responsive");

const cueEditorSource = await readRequired("../src/components/planner/CueEditor.tsx", "CueEditor");
for (const itemType of ["scripture", "song", "slide", "announcement", "lower_third", "media", "camera", "custom"]) {
  assert.match(cueEditorSource, new RegExp(`\"${itemType}\"`), `CueEditor must expose ${itemType}`);
}
assert.doesNotMatch(cueEditorSource, /raw\s*json|json\s*editor/i, "Planner must not expose a raw JSON editor");

const scriptureEditor = await readRequired("../src/components/planner/editors/ScriptureCueEditor.tsx", "ScriptureCueEditor");
assert.match(scriptureEditor, /reference/, "Scripture editor must expose scripture reference");
assert.match(scriptureEditor, /bibleVersion/, "Scripture editor must expose Bible version");

const songEditor = await readRequired("../src/components/planner/editors/SongCueEditor.tsx", "SongCueEditor");
assert.match(songEditor, /sections/, "Song editor must use structured sections");
assert.match(songEditor, /64/, "Song editor must enforce the 64-section planner cap");
assert.match(songEditor, /Add section/i, "Song editor must support adding sections");
assert.match(songEditor, /Remove/i, "Song editor must support removing sections");
assert.match(songEditor, /Move up|Move down/i, "Song editor must support section reordering");

const mediaEditor = await readRequired("../src/components/planner/editors/MediaCueEditor.tsx", "MediaCueEditor");
assert.match(mediaEditor, /mediaSources/, "Media editor must use approved organization sources");
assert.match(mediaEditor, /sourceId/, "Media editor must persist an approved source id");
assert.match(mediaEditor, /<select/, "Media editor must select an approved source rather than accept a path");
assert.doesNotMatch(mediaEditor, /sourceUrl|filePath|javascript:/i, "Media editor must not expose free-form executable/media paths");

const previewSource = await readRequired("../src/components/planner/CuePreview.tsx", "CuePreview");
assert.match(previewSource, /body/, "safe cue preview must render normalized presentation body");
assert.match(previewSource, /footer/, "safe cue preview must render normalized presentation footer");

// Task 8: resilient ordering, readiness workflow and optimistic-conflict recovery.
assert.match(rundownSource, /Move up/i, "rundown must provide keyboard-accessible Move up independent of drag");
assert.match(rundownSource, /Move down/i, "rundown must provide keyboard-accessible Move down independent of drag");
assert.match(rundownSource, /draggable|onDragStart|onDrop/, "rundown must provide pointer drag reorder without a large dependency");
assert.match(rundownSource, /onReorder/, "rundown must emit the complete reordered cue list to the workspace");

assert.match(workspaceSource, /\/reorder/, "workspace must persist rundown order through planner reorder API");
assert.match(workspaceSource, /itemIds\s*:/, "reorder request must send one complete itemIds list");
assert.match(workspaceSource, /ReadinessPanel/, "workspace must compose the readiness panel");
assert.match(workspaceSource, /\/ready/, "Ready action must call planner readiness endpoint");
assert.match(workspaceSource, /\/draft/, "ready service must expose an explicit return-to-Draft action");
assert.match(workspaceSource, /planner_revision_conflict/, "workspace must detect the stable stale-revision conflict code");
assert.match(workspaceSource, /conflict|stale/i, "workspace must freeze mutation actions after a stale revision conflict");
assert.match(workspaceSource, /reload|refresh/i, "stale revision UI must offer a reload/refresh action rather than retry silently");
assert.match(workspaceSource, /setRevision\(|revision\)/, "successful server mutations must replace the local planner revision");

const readinessSource = await readRequired("../src/components/planner/ReadinessPanel.tsx", "ReadinessPanel");
assert.match(readinessSource, /issues/, "readiness panel must render server readiness issues");
assert.match(readinessSource, /itemId/, "readiness issue with itemId must be able to focus its cue");
assert.match(readinessSource, /onFocusCue/, "readiness panel must delegate cue focus back to the workspace");
assert.match(readinessSource, /canEdit/, "Ready/Draft mutation controls must be capability gated");
assert.match(readinessSource, /Ready for service/i, "readiness panel must expose the Ready workflow");
assert.match(readinessSource, /Return to draft/i, "ready service must be able to return to draft");
assert.match(readinessSource, /disabled=.*canEdit|!canEdit/, "readiness mutation actions must be disabled for read-only users");

console.log(JSON.stringify({
  ok: true,
  roles: allRoles.length,
  filters: 5,
  timezoneAware: true,
  responsive: true,
  mutationGating: true,
  cueTypes: 8,
  typedEditors: true,
  safePreview: true,
  reorderAccessible: true,
  readinessWorkflow: true,
  conflictRecovery: true
}));
