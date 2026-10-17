import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const count = (source, pattern) => [...source.matchAll(pattern)].length;

const stage = read("src/components/cockpit/ProgramPreviewStage.tsx");
const depth = read("src/components/cockpit/CockpitDepthControls.tsx");
const header = read("src/components/cockpit/CockpitHeader.tsx");
const workspace = read("src/components/cockpit/CockpitWorkspace.tsx");
const nowRail = read("src/components/cockpit/NowRail.tsx");
const nextRail = read("src/components/cockpit/NextRail.tsx");
const dialog = read("src/components/planner/CreateServiceDialog.tsx");
const css = read("src/app/globals.css");

assert.match(stage, /(?:aspect-video[^\"]*w-full|w-full[^\"]*aspect-video)/, "Preview/Program surfaces must be width-driven 16:9 landscape stages");
for (const forcedHeight of ["min-h-60", "lg:min-h-[300px]", "lg:min-h-[360px]"]) {
  assert.equal(stage.includes(forcedHeight), false, `stage geometry must not include competing ${forcedHeight}`);
}
assert.match(stage, /md:grid-cols-2/, "Preview and Program monitors must have equal desktop width");
assert.equal(stage.includes("1.35fr"), false, "Program must not be wider than Preview");
assert.doesNotMatch(stage, /program \? [^\n]*text-3xl[^\n]*text-2xl/, "Preview and Program titles must use the same typography scale");
assert.doesNotMatch(stage, /program \? [^\n]*text-lg[^\n]*text-base/, "Preview and Program bodies must use the same typography scale");
assert.match(stage, /"Preview empty"/, "empty Preview monitor copy must stay concise");
assert.match(stage, /"Program clear"/, "empty Program monitor copy must stay concise");
assert.equal(stage.includes("Preview is your safe staging area. Prepare content here before taking it to Program — nothing goes live until you Take."), false, "long operator guidance must not live inside Preview");
assert.equal(stage.includes("The audience sees black. Stage something into Preview, then Take it live."), false, "long operator guidance must not live inside Program");

assert.match(depth, /md:sticky/, "desktop live stage must remain sticky while operators work in surrounding rails");
assert.match(depth, /md:top-\[84px\]/, "sticky live stage must clear the 68px Cockpit header with breathing room");
assert.match(depth, /xl:grid-cols-\[minmax\(0,1fr\)_330px\]/, "live monitors must keep the dominant desktop width beside one compact assistant rail");
assert.match(depth, /aria-label=\"Now and next assistant rail\"/, "Now and Next must share one clearly labelled side rail");
assert.ok(count(depth, /xl:max-h-\[calc\(100dvh-7rem\)\]/g) >= 1, "assistant rail must be viewport-bounded at xl");
assert.ok(count(depth, /xl:overflow-y-auto/g) >= 1, "assistant rail must scroll independently at xl");
assert.ok(count(depth, /xl:overscroll-contain/g) >= 1, "assistant rail scrolling must be contained instead of pulling the live stage away");
assert.equal(depth.includes("xl:col-start-1"), false, "Now must no longer occupy a separate left rail that shrinks the live stage");
assert.equal(depth.includes("xl:col-start-3"), false, "Next must no longer occupy a separate right rail separate from Now");
assert.match(depth, /href=\"\/scripture\"/, "operators need one-tap Scripture access beside the live stage");
assert.match(depth, /href=\"\/media\"/, "operators need one-tap Media access beside the live stage");
assert.match(depth, /href=\"\/cameras\"/, "operators need one-tap Cameras access beside the live stage");
assert.match(depth, /href=\"\/ai-director\"/, "operators need one-tap AI Director access beside the live stage");

assert.match(stage, /TAKE PREVIEW LIVE/, "the primary live action must say exactly what will happen");
assert.match(stage, /CLEAR LIVE/, "the destructive live action must use plain operator language");
assert.match(stage, /Nothing reaches the audience until you take it live\./, "stage guidance must explain the safety boundary in plain language");
assert.equal(stage.includes("Cloud intent and physical Edge truth remain separate."), false, "technical architecture wording must not occupy the live operator control strip");

assert.match(dialog, /sm:items-start/, "Create Service must align safely from the top on desktop instead of vertical centering");
assert.match(dialog, /sm:pt-20/, "Create Service must leave safe top clearance");
assert.match(dialog, /sm:pb-6/, "Create Service must retain bottom breathing room while the backdrop scrolls");
assert.match(dialog, /sm:max-h-\[calc\(100dvh-7rem\)\]/, "Create Service panel must be bounded to the visible viewport");
assert.match(dialog, /overflow-y-auto/, "Create Service must retain internal scrolling for short viewports");

assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/, "pointer affordance must be limited to hover-capable pointer devices");
assert.match(css, /a\[href\]/, "links must participate in the shared pointer affordance");
assert.match(css, /button:not\(:disabled\)/, "enabled buttons must participate in the shared pointer affordance");
assert.match(css, /\[role="button"\]:not\(\[aria-disabled="true"\]\)/, "button-like controls must participate in the shared pointer affordance");
assert.match(css, /cursor:\s*pointer/, "enabled shared interactions must use cursor:pointer");
assert.match(css, /cursor:\s*not-allowed/, "disabled controls must use cursor:not-allowed");

for (const [name, source] of [["ProgramPreviewStage", stage], ["CockpitDepthControls", depth], ["CockpitHeader", header], ["CockpitWorkspace", workspace], ["NowRail", nowRail], ["NextRail", nextRail], ["CreateServiceDialog", dialog]]) {
  assert.equal(/text-\[(?:10|11)px\]/.test(source), false, `${name} must not use 10-11px operational copy after the readability pass`);
}

console.log(JSON.stringify({
  ok: true,
  landscapeStages: true,
  persistentLiveStage: true,
  independentRails: true,
  modalViewportSafe: true,
  pointerAffordance: true,
  typographyFloor: "12px"
}));
