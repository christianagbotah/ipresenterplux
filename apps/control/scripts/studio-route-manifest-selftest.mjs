#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const manifestPath=path.join(root,".next/server/app-paths-manifest.json");
assert.ok(existsSync(manifestPath),"Next.js production route manifest must exist; run next build first");
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
const required={
  "/page":"/",
  "/operator/page":"/operator",
  "/media/page":"/media",
  "/media/import/page":"/media/import",
  "/cameras/page":"/cameras",
  "/ai-director/page":"/ai-director",
  "/archive/page":"/archive",
  "/archive/[id]/page":"/archive/[id]"
};
for(const [key,route] of Object.entries(required)){
  assert.equal(typeof manifest[key],"string",`${route} must be emitted in the production App Router manifest`);
}
console.log(JSON.stringify({ok:true,routes:Object.values(required),manifest:".next/server/app-paths-manifest.json"}));
