import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const controlRoot = path.resolve(import.meta.dirname, "..");
const routesPath = path.join(controlRoot, "src/components/navigation/studio-routes.ts");
const sidebarPath = path.join(controlRoot, "src/components/navigation/StudioSidebar.tsx");
const mobilePath = path.join(controlRoot, "src/components/navigation/StudioMobileNav.tsx");
const dashboardPath = path.join(controlRoot, "src/app/DashboardPage.tsx");

assert.ok(existsSync(routesPath), "shared studio route source must exist");

const { studioRoutes, isStudioRouteActive, visibleStudioRoutes } = await import(
  pathToFileURL(routesPath).href + `?selftest=${Date.now()}`
);

const expectedRoutes = [
  ["Control Room", "/"],
  ["Scripture", "/scripture"],
  ["Songs & Media", "/media"],
  ["Cameras", "/cameras"],
  ["AI Director", "/ai-director"],
  ["Translations", "/translations"],
  ["Streaming", "/streaming"],
  ["Audience", "/audience"],
  ["Archive", "/archive"],
  ["Settings", "/settings"]
];

assert.deepEqual(
  studioRoutes.map((route) => [route.label, route.href]),
  expectedRoutes,
  "studio navigation must expose the approved route map without dead entries"
);

for (const route of studioRoutes) {
  const pagePath = route.href === "/"
    ? path.join(controlRoot, "src/app/page.tsx")
    : path.join(controlRoot, `src/app${route.href}/page.tsx`);
  assert.ok(existsSync(pagePath), `${route.label} must resolve to a real App Router page at ${route.href}`);
}
assert.equal(isStudioRouteActive("/", "/"), true);
assert.equal(isStudioRouteActive("/scripture", "/"), false);
assert.equal(isStudioRouteActive("/archive/123", "/archive"), true);
assert.equal(isStudioRouteActive("/settings/devices", "/settings"), true);
assert.equal(isStudioRouteActive("/streaming-health", "/streaming"), false);

const noPremium = visibleStudioRoutes({
  canTranslations: false,
  canStreaming: false,
  canSettings: false
});
assert.equal(noPremium.some((route) => route.href === "/translations"), false);
assert.equal(noPremium.some((route) => route.href === "/streaming"), false);
assert.equal(noPremium.some((route) => route.href === "/settings"), false);
assert.equal(noPremium.some((route) => route.href === "/scripture"), true);

const allCapabilities = visibleStudioRoutes({
  canTranslations: true,
  canStreaming: true,
  canSettings: true
});
assert.deepEqual(allCapabilities.map((route) => route.href), studioRoutes.map((route) => route.href));

for (const filePath of [sidebarPath, mobilePath]) {
  assert.ok(existsSync(filePath), `${path.basename(filePath)} must exist`);
  const source = readFileSync(filePath, "utf8");
  assert.match(source, /from ["']\.\/studio-routes["']/, `${path.basename(filePath)} must consume the shared route source`);
  assert.match(source, /usePathname\(/, `${path.basename(filePath)} must derive active state from the pathname`);
}

const readinessPath = path.join(controlRoot, "src/components/navigation/StudioReadinessPage.tsx");
assert.ok(existsSync(readinessPath), "shared readiness shell must exist for connected-but-not-yet-full workspaces");
const readiness = readFileSync(readinessPath, "utf8");
assert.match(readiness, /order by uor\.granted_at/, "readiness membership ordering must use the real user_organization_roles.granted_at column");
assert.doesNotMatch(readiness, /uor\.created_at/, "readiness shell must not query a nonexistent membership created_at column");

const dashboard = readFileSync(dashboardPath, "utf8");
assert.match(dashboard, /user_organization_roles where user_id=\$1 order by granted_at limit 1/, "Control Room no-service membership fallback must use granted_at");
assert.doesNotMatch(dashboard, /user_organization_roles where user_id=\$1 order by created_at limit 1/, "Control Room must not query nonexistent membership created_at");
assert.match(dashboard, /StudioSidebar/, "Control Room must render the shared desktop sidebar");
assert.match(dashboard, /StudioMobileNav/, "Control Room must render the shared mobile navigation");
assert.doesNotMatch(dashboard, /const\s+nav\s*=\s*\[/, "Control Room must not retain a second hard-coded studio route list");

console.log(JSON.stringify({
  ok: true,
  routes: studioRoutes.length,
  activeState: "pathname",
  desktopMobileRouteParity: true
}));
