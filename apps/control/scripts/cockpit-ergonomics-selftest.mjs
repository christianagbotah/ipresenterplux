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
const nextActions = read("src/components/cockpit/NextItemActions.tsx");
const sidebar = read("src/components/navigation/StudioSidebar.tsx");
const dialog = read("src/components/planner/CreateServiceDialog.tsx");
const css = read("src/app/globals.css");

assert.match(stage, /(?:aspect-video[^\"]*w-full|w-full[^\"]*aspect-video)/, "Preview/Program surfaces must be width-driven 16:9 landscape stages");
for (const forcedHeight of ["min-h-60", "lg:min-h-[300px]", "lg:min-h-[360px]"]) {
  assert.equal(stage.includes(forcedHeight), false, `stage geometry must not include competing ${forcedHeight}`);
}
assert.match(stage, /ip-stage-split/, "Preview and Program must share one resizable side-by-side stage row");
assert.match(stage, /--ip-stage-columns/, "the operator-owned PGM|PST split must drive the stage grid template");
assert.match(stage, /DEFAULT_PREVIEW_SHARE = 60/, "the stage split must default to a 60/40 preview|program layout");
assert.match(stage, /STAGE_SPLIT_STORAGE_KEY/, "the stage split must persist per device");
assert.match(stage, /role="separator"/, "the resizable divider must be an accessible separator");
assert.match(stage, /onDoubleClick=\{\(\) => applyPreviewShare\(DEFAULT_PREVIEW_SHARE\)\}/, "double-clicking the divider must reset the 60/40 split");
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
assert.equal(depth.includes("xl:grid-cols-[260px_minmax(0,1fr)_300px]"), false, "the old three-column Now/live/Next layout must not return");
assert.equal(depth.includes("xl:col-start-3"), false, "Next must no longer occupy a separate third rail away from Now");
assert.match(depth, /href=\"\/scripture\"/, "operators need one-tap Scripture access beside the live stage");
assert.match(depth, /href=\"\/media\"/, "operators need one-tap Media access beside the live stage");
assert.match(depth, /href=\"\/cameras\"/, "operators need one-tap Cameras access beside the live stage");
assert.match(depth, /href=\"\/ai-director\"/, "operators need one-tap AI Director access beside the live stage");
assert.match(depth, /aria-label=\"Operator command bar\"/, "desktop depth, source and focus controls must share one compact operator command bar");
assert.equal(depth.includes('aria-label="Operator source shortcuts"'), false, "source shortcuts must not consume a separate desktop toolbar row");
assert.doesNotMatch(depth, /<p id=\"ip-cockpit-depth-hint\" className=\"mb-3 -mt-1/, "depth guidance must be assistive-only instead of a persistent row above the stage");
for (const href of ["/scripture", "/media", "/cameras", "/ai-director"]) {
  const escaped = href.replaceAll("/", "\\/");
  assert.match(depth, new RegExp(`href=\"${escaped}\"[^>]*min-h-11`), `${href} quick action must keep a 44px minimum target`);
}

assert.match(stage, /TAKE PREVIEW LIVE/, "the primary live action must say exactly what will happen");
assert.match(stage, /CLEAR LIVE/, "the destructive live action must use plain operator language");
assert.match(stage, /Nothing reaches the audience until you take it live\./, "stage guidance must explain the safety boundary in plain language");
assert.equal(stage.includes("Cloud intent and physical Edge truth remain separate."), false, "technical architecture wording must not occupy the live operator control strip");

assert.match(stage, /Program monitor/, "Program surface needs an explicit accessible monitor label");
assert.match(stage, /Preview monitor/, "Preview surface needs an explicit accessible monitor label");
assert.match(stage, /ON AIR/, "Program must expose an unmistakable on-air state");
assert.match(stage, /Ready to take/, "Preview must expose a ready-to-take state");
assert.match(stage, /ip-stage-canvas/, "monitor content must use the bounded stage canvas");
assert.match(stage, /ip-stage-copy/, "long monitor content must use the bounded stage copy container");
assert.doesNotMatch(stage, /overflow-y-auto/, "Preview/Program canvases must never expose internal vertical scrolling");
assert.doesNotMatch(stage, /ip-scrollbar-thin/, "Preview/Program canvases must not behave like scrollable web panels");
assert.match(stage, /ip-stage-fit-content/, "stage content must render through the auto-fit content wrapper");
assert.match(stage, /ResizeObserver/, "stage auto-fit must recompute when the monitor size changes");
assert.match(stage, /scrollHeight/, "stage auto-fit must measure rendered content height before scaling");
assert.match(stage, /content\.style\.transform\s*=\s*`scale\(\$\{scale\}\)`/, "stage content must scale proportionally to remain inside the fixed canvas");

assert.match(css, /\.ip-stage-canvas/, "stage canvas styling must be shared in globals.css");
assert.match(css, /container-type:\s*inline-size/, "monitor typography must scale to monitor width rather than viewport width");
assert.match(css, /\.ip-stage-copy[\s\S]*overflow:\s*hidden/, "stage copy must clip its fixed canvas instead of creating a scrollbar");
assert.match(css, /\.ip-stage-copy[\s\S]*overflow-wrap:\s*anywhere/, "long stage copy must wrap safely inside the monitor");
assert.match(css, /\.ip-stage-fit-content[\s\S]*transform-origin:\s*center/, "auto-fit content must scale from the monitor center");

assert.match(nextRail, /index === 0/, "the first Next item must receive a stronger visual priority treatment");
assert.match(nextRail, /break-words/, "long Next titles and reasons must wrap rather than truncate out of context");
assert.match(nowRail, /Live context/, "Now rail must clearly identify its live-context role");
assert.equal(/text-\[(?:10|11)px\]/.test(nextActions), false, "Next item actions must keep readable 12px-or-larger labels");

assert.match(sidebar, /h-dvh/, "desktop Studio sidebar must follow the dynamic viewport height");
assert.match(sidebar, /flex-col/, "desktop Studio sidebar must use a bounded flex column");
assert.match(sidebar, /overflow-y-auto/, "Studio navigation must scroll when all workspaces do not fit vertically");
assert.equal(sidebar.includes("absolute bottom-4"), false, "Settings must stay in normal sidebar flow instead of overlaying routes");
assert.equal(fs.existsSync(path.join(root, "src/app/live/studio-review/page.tsx")), false, "internal Studio review fixtures must not ship as a production route");

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
  fixedStageCanvases: true,
  autoFitStageContent: true,
  persistentLiveStage: true,
  independentRails: true,
  modalViewportSafe: true,
  pointerAffordance: true,
  typographyFloor: "12px"
}));
