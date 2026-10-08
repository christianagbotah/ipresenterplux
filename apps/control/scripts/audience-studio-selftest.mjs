#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const linksPath = path.join(root, "src/lib/audience-links.ts");
assert.ok(existsSync(linksPath), "audience-links.ts must exist");
const { canonicalAudienceUrl, audienceQrSvg } = await import("../src/lib/audience-links.ts");

const serviceId = "11111111-2222-4333-8444-555555555555";
const canonical = canonicalAudienceUrl("https://studio.example.com/admin?x=1", serviceId);
assert.equal(canonical, `https://studio.example.com/live?service=${serviceId}`);
const encoded = canonicalAudienceUrl("https://studio.example.com", "service id/with spaces");
assert.equal(encoded, "https://studio.example.com/live?service=service+id%2Fwith+spaces");

const svg = await audienceQrSvg(canonical);
assert.match(svg, /^<svg[\s>]/u, "QR helper must return SVG");
assert.match(svg, /<desc>https:\/\/studio\.example\.com\/live\?service=11111111-2222-4333-8444-555555555555<\/desc>/u, "QR SVG must identify its exact encoded payload");
assert.equal(svg, await audienceQrSvg(canonical), "same canonical URL must generate deterministic QR SVG");
assert.notEqual(svg, await audienceQrSvg(canonicalAudienceUrl("https://studio.example.com", "other")), "different payload must generate a different QR");

const pagePath = path.join(root, "src/app/audience/page.tsx");
const componentPath = path.join(root, "src/components/audience/AudienceStudio.tsx");
assert.ok(existsSync(componentPath), "AudienceStudio component must exist");
const page = readFileSync(pagePath, "utf8");
const component = readFileSync(componentPath, "utf8");
assert.doesNotMatch(page, /StudioReadinessPage/u, "Audience route must no longer be a readiness placeholder");
assert.match(page, /AudienceStudio/u, "Audience route must render AudienceStudio");
assert.match(page, /canonicalAudienceUrl/u, "Audience route must build the canonical service link server-side");
assert.match(page, /audienceQrSvg/u, "Audience route must build the QR locally server-side");
assert.match(page, /order by granted_at/u, "membership fallback must use the real granted_at schema column");

for (const copy of ["No service selected", "Ready to share", "Live now", "Service ended", "Copy audience link", "Open audience view", "Audience preview"]) {
  assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `Audience Studio must expose ${copy}`);
}
assert.match(component, /languages/u, "Audience Studio must show language availability");
assert.match(component, /scripture/u, "Audience Studio must show current Scripture summary");
assert.match(component, /caption/u, "Audience Studio must show current caption summary");
assert.match(component, /streamStatus/u, "Audience Studio must show stream readiness");

console.log(JSON.stringify({ ok: true, canonicalLink: true, qrLocal: true, statusStates: 4, preview: true }));
