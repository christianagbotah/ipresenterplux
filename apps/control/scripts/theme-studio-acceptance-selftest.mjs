#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const files = {
  studio: "../src/components/themes/ThemeStudio.tsx",
  preview: "../src/components/themes/ThemePreview.tsx",
  themeService: "../src/lib/presentation-themes.ts",
  edgeRoute: "../src/app/api/v1/edge/presentation/items/[id]/route.ts",
  edgeRenderer: "../../edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs",
  edgeTheme: "../../edge-agent/src/iPresenterPlux.Edge.Core/Runtime/PresentationThemeMetadata.cs",
  uat: "../../../docs/qa/theme-studio-field-uat.md"
};
for (const relative of Object.values(files)) await access(new URL(relative, import.meta.url));
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), "utf8")])));
assert.match(source.studio, /Save as custom|Save theme/);
assert.match(source.studio, /Apply to service/);
assert.doesNotMatch(source.studio, /program\.show|program\.clear|TAKE PREVIEW LIVE/i);
assert.match(source.themeService, /resolveThemeAppearance/);
assert.match(source.themeService, /contentVariants/);
assert.match(source.themeService, /outputVariants/);
assert.match(source.edgeRoute, /themeAppearanceV1/);
assert.match(source.edgeRoute, /contentType:\s*"scripture"/);
assert.match(source.edgeRoute, /output:\s*"projector"/);
assert.match(source.edgeRenderer, /PresentationThemeMetadata\.Resolve/);
assert.match(source.edgeRenderer, /textContent/);
assert.doesNotMatch(source.edgeRenderer, /innerHTML|eval\(/i);
assert.match(source.edgeTheme, /MaximumPayloadLength/);
assert.match(source.edgeTheme, /GradientTokens/);
assert.match(source.edgeTheme, /Version\s*!=\s*1/);
assert.match(source.preview, /MIN_PREVIEW_TEXT_PX\s*=\s*12/);
for (const token of ["scripture_long","lyrics_long","announcement","lower_third","image_background","logo_safe_zone","theme_switch_no_take","invalid_theme_fallback","offline_continuity"]) assert.ok(source.uat.includes(token), `field UAT must include ${token}`);
console.log(JSON.stringify({ ok: true, boundedThemeTransport: true, noProgramMutation: true, edgeSanitizer: true, physicalUatGate: true }));
