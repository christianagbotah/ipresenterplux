import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pagePath = path.join(root, "src/app/scripture/page.tsx");
const workspacePath = path.join(root, "src/components/scripture/ScriptureWorkspace.tsx");
const libraryRoutePath = path.join(root, "src/app/api/v1/scriptures/library/route.ts");

for (const file of [pagePath, workspacePath, libraryRoutePath]) {
  assert.ok(existsSync(file), `${path.relative(root, file)} must exist`);
}

const page = readFileSync(pagePath, "utf8");
const workspace = readFileSync(workspacePath, "utf8");
const libraryRoute = readFileSync(libraryRoutePath, "utf8");

assert.match(page, /auth\(\)/, "Scripture page must require authentication");
assert.match(page, /StudioSidebar/, "Scripture page must use shared desktop navigation");
assert.match(page, /StudioMobileNav/, "Scripture page must use shared mobile navigation");
assert.match(page, /case when s\.status='live' then 0 when s\.status='ready' then 1 else 2 end/, "Scripture page must use current-service ordering");
assert.match(page, /state <> 'dismissed'/, "Scripture page must load recent actionable/history detections");
assert.match(page, /ScriptureWorkspace/, "Scripture page must render the workspace");

assert.match(libraryRoute, /listLocalBibleVersions/, "library API must use local Bible versions");
assert.match(libraryRoute, /listBibleBooks/, "library API must use local Bible books");
assert.match(libraryRoute, /listBibleChapter/, "library API must use local Bible verses");
assert.match(libraryRoute, /resolveLocalScripture/, "library API must support read-only direct reference lookup");
assert.match(libraryRoute, /Cache-Control["']?\s*:\s*["']no-store/, "library responses must be no-store");
assert.doesNotMatch(libraryRoute, /https?:\/\//, "library API must not call an external Bible provider");

assert.match(workspace, /John 3:16/, "workspace must expose direct-reference search");
assert.match(workspace, />Version</, "workspace must expose Bible version browsing");
assert.match(workspace, />Book</, "workspace must expose book browsing");
assert.match(workspace, />Chapter</, "workspace must expose chapter browsing");
assert.match(workspace, /From verse/, "workspace must expose verse-range start");
assert.match(workspace, /To verse/, "workspace must expose verse-range end");
assert.match(workspace, /\/api\/v1\/scriptures\/library/, "workspace must use the read-only local library API");
assert.match(workspace, /\/api\/v1\/scriptures\/manual/, "workspace must explicitly add a chosen passage to the service");
assert.match(workspace, /\/api\/v1\/scriptures\/\$\{id\}\/state/, "workspace must reuse the existing Scripture state API");
assert.match(workspace, /selected\.state !== "preview"/, "Take Live must remain disabled until the selected item is in Preview");
assert.match(workspace, /Take Live/, "workspace must expose explicit Take Live");
assert.match(workspace, /Clear Program/, "workspace must expose explicit Program clear");
assert.match(workspace, /Recent AI & manual detections/, "workspace must show recent detections");
assert.match(workspace, /Bible library unavailable/, "workspace must explain a missing local Bible library");
assert.match(workspace, /Bible browsing remains available/, "ended-service state must preserve browsing and explain disabled live controls");
assert.match(workspace, /No service is available/, "no-service state must explain why live controls are disabled");
assert.match(workspace, /canOperate/, "workspace must gate live mutations on ready\/live service + operator permission");

const manualIndex = workspace.indexOf('/api/v1/scriptures/manual');
const stateIndex = workspace.indexOf('/api/v1/scriptures/${id}/state');
assert.ok(manualIndex >= 0 && stateIndex >= 0 && manualIndex !== stateIndex, "manual selection and output state transitions must remain separate calls");

console.log(JSON.stringify({
  ok: true,
  route: "/scripture",
  search: "local-reference",
  browse: "version-book-chapter-range",
  workflow: "find -> add -> preview -> take-live",
  endedServiceBrowsing: true
}));
