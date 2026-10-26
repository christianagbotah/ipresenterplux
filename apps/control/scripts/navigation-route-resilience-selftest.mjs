import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const translations = await read("src/app/translations/page.tsx");
assert.match(translations, /getCurrentServiceForUser/u, "Translations must use shared membership/current-service authority");
assert.match(translations, /canTranslations/u, "Translations must enforce translation capability through shared authority");
assert.doesNotMatch(translations, /from\s+user_organization_roles[\s\S]{0,320}order\s+by\s+created_at/iu, "Translations must not query the removed membership created_at column");

const layout = await read("src/app/layout.tsx");
assert.match(layout, /WorkspaceBackButton/u, "root app layout must install the shared Back control");
const back = await read("src/components/navigation/WorkspaceBackButton.tsx");
assert.match(back, /router\.back\(\)/u, "Back control must use real navigation history when it is safe");
assert.match(back, /router\.push\("\/"\)/u, "Back control must fall back to Control Room");
for (const excluded of ["/", "/login", "/live"]) assert.ok(back.includes(JSON.stringify(excluded)), `Back control must exclude ${excluded}`);
for (const localBack of ["/admin/licensing", "/media/import", "/planner", "/settings", "/streaming"]) assert.ok(back.includes(JSON.stringify(localBack)), `Shared Back control must stand down where ${localBack} already has a local parent-back button`);
for (const prefix of ["/planner/", "/settings/"]) assert.ok(back.includes(JSON.stringify(prefix)), `Shared Back control must stand down for ${prefix} child routes with local parent-back buttons`);

async function walk(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walk(full));
    else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) results.push(full);
  }
  return results;
}
const sourceRoot = path.join(root, "src");
for (const file of await walk(sourceRoot)) {
  const text = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  assert.doesNotMatch(text, /\b(?:user_organization_roles|uor)\.created_at\b/iu, `${relative} references the removed membership created_at column`);
  assert.doesNotMatch(
    text,
    /from\s+user_organization_roles\s+where[^;`]{0,300}?order\s+by\s+created_at/iu,
    `${relative} contains a direct stale membership created_at ordering`
  );
}

console.log(JSON.stringify({ ok: true, sharedBackNavigation: true, translationsMembershipAuthority: true, staleMembershipOrdering: false }));
