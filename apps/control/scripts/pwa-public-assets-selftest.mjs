#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
const manifest = await readFile(new URL("../src/app/manifest.ts", import.meta.url), "utf8");

assert.match(manifest, /export default function/i, "App Router must define a web manifest");
assert.equal(proxy.includes("manifest\\\\.webmanifest"), true, "auth proxy must explicitly exclude /manifest.webmanifest");
assert.match(proxy, /favicon\.ico\|manifest/, "manifest exclusion must be part of the public matcher boundary");

console.log(JSON.stringify({ok:true,manifestPublic:true,pwaInstallMetadataAccessible:true}));
