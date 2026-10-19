#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = {
  page: "../src/app/themes/page.tsx",
  studio: "../src/components/themes/ThemeStudio.tsx",
  preview: "../src/components/themes/ThemePreview.tsx",
  settings: "../src/app/settings/page.tsx",
  routes: "../src/components/navigation/studio-routes.ts",
  sidebar: "../src/components/navigation/StudioSidebar.tsx",
  mobileNav: "../src/components/navigation/StudioMobileNav.tsx",
  cockpitHeader: "../src/components/cockpit/CockpitHeader.tsx",
  currentService: "../src/lib/current-service.ts"
};
for (const relative of Object.values(files)) await access(new URL(relative, import.meta.url));
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), "utf8")])));

assert.match(source.page, /auth\(\)/, "Theme Studio page must authenticate");
assert.match(source.page, /ThemeStudio/, "Theme Studio page must render the designer");
assert.match(source.page, /listPresentationThemes/, "Theme Studio page must load tenant-scoped themes through the authority service");
assert.match(source.page, /ensureBuiltinPresentationThemes/, "Theme Studio page must idempotently seed built-ins for organizations created after the theme migration");
assert.doesNotMatch(source.studio, /initialThemes\[0\]!/, "Theme Studio must not crash when no themes are available");
assert.match(source.routes, /Theme Studio/);
assert.match(source.routes, /\/themes/);
assert.match(source.settings, /\/themes/);
assert.match(source.sidebar, /Palette/, "desktop Studio navigation must map the theme icon");
assert.match(source.mobileNav, /Palette/, "mobile Studio navigation must map the theme icon");

for (const name of ["Sunday Modern","Lower Third Scripture","Sermon Scripture","Worship Lyrics","Announcement","Youth Service","Conference","Funeral","Wedding"]) {
  assert.ok(source.studio.includes(name) || source.page.includes(name), `Theme Studio must expose built-in '${name}'`);
}
for (const section of ["Typography","Background","Layout","Lower Third","Logo","Motion"]) assert.ok(source.studio.includes(section), `Theme Studio must expose ${section}`);
for (const fixture of ["Scripture","Lyrics","Announcement","Lower Third"]) assert.ok(source.studio.includes(fixture) || source.preview.includes(fixture), `Theme preview must expose ${fixture}`);
assert.match(source.preview, /MIN_PREVIEW_TEXT_PX\s*=\s*12/, "preview text must enforce a 12px readability floor");
assert.match(source.studio, /min-h-11|min-h-12/, "important Theme Studio mobile controls must be at least 44px");
assert.match(source.studio, /Save theme|Save as custom/);
assert.match(source.studio, /Apply to service/);
assert.match(source.studio, /Reset draft/);
assert.match(source.studio, /useState/, "appearance editing must remain local draft state before explicit Save");
assert.match(source.studio, /\/api\/v1\/themes/);
assert.match(source.studio, /\/api\/v1\/services\/\$\{service\.id\}\/theme/);
assert.doesNotMatch(source.studio + source.preview, /TAKE PREVIEW LIVE|program\.show|program\.clear|\/api\/v1\/scriptures\/.+state/i, "Theme Studio must not expose or bypass live Program authority");
assert.match(source.preview, /midnight/);
assert.match(source.preview, /violet_pink/);
assert.doesNotMatch(source.preview, /dangerouslySetInnerHTML|eval\(|new Function/, "theme preview must never execute theme content");

assert.match(source.currentService, /active_theme_name/, "current service must carry active theme name for Essential Cockpit visibility");
assert.match(source.cockpitHeader, /activeThemeName|Sunday Modern/, "Essential Cockpit must show active/default theme name only");
assert.doesNotMatch(source.cockpitHeader, /Typography|Background|Lower Third|Save theme/, "Cockpit header must not contain theme editing controls");

console.log(JSON.stringify({ ok:true, route:"/themes", sections:6, fixtures:4, builtins:9, localDraft:true, mobileTouchFloor:44, previewTextFloor:12, noProgramAuthority:true }));
