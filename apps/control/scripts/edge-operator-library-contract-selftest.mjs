import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const catalogRoute = await readFile(new URL("../src/app/api/v1/edge/operator/catalog/route.ts", import.meta.url), "utf8");
const libraryRoute = await readFile(new URL("../src/app/api/v1/edge/operator/library/[id]/route.ts", import.meta.url), "utf8");
const queries = await readFile(new URL("../src/lib/edge-operator-catalog-queries.ts", import.meta.url), "utf8");
const resolver = await readFile(new URL("../src/lib/edge-operator-library.ts", import.meta.url), "utf8");

assert.match(catalogRoute, /EDGE_OPERATOR_LIBRARY_ITEMS_SQL/, "Edge catalog must query the organization library");
assert.match(catalogRoute, /libraryItems/, "Edge catalog must return bounded library summaries");
assert.match(queries, /EDGE_OPERATOR_LIBRARY_ITEMS_SQL/, "Library SQL must be centralized with the Edge catalog queries");
assert.match(queries, /limit 200/i, "Library synchronization must be hard-capped");

assert.match(libraryRoute, /authenticateEdgeDevice\(request\)/, "Library item resolve must use device authentication");
assert.match(libraryRoute, /resolveEdgeOperatorLibraryItem/, "Library item route must delegate to the safe resolver");
assert.match(resolver, /media_library_items/, "Resolver must scope resolution to library rows");
assert.match(resolver, /organization_id=\$2/, "Resolver must enforce organization scope");
assert.match(resolver, /https:/, "Media resolver must require HTTPS assets");
assert.match(resolver, /assetVersion/, "Resolved media must receive a stable asset version");
assert.doesNotMatch(catalogRoute, /source_public_config|assetUrl|downloadUrl/, "Catalog summaries must never expose raw media source configuration");

console.log("Edge operator organization-library contract self-test passed.");
