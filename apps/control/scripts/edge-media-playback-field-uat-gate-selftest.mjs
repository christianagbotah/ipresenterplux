#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateEdgeMediaPlaybackFieldUat, createEdgeMediaPlaybackFieldUatTemplate } from "../src/lib/edge-media-playback-field-uat.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(scriptDir, "edge-media-playback-field-uat-gate.mjs");
assert.ok(existsSync(cliPath));

function evidence(platform, commit = "abc1234") {
  return {
    platform,
    buildCommit: commit,
    device: `${platform}-uat-device`,
    projector: "Sanctuary HDMI",
    mediaFixtureIds: ["image-fixture", "video-fixture", "audio-fixture"],
    status: "pass",
    offlinePlayback: true,
    projectorChecked: true,
    contributionAvChecked: true,
    clearToScripture: true,
    dynamicRestartNoAutoResume: true,
    videoDriftMs: 180,
    contributionAvSkewMs: 85,
    notes: "physical UAT complete"
  };
}

const goodReport = { buildCommit: "abc1234", evidence: [evidence("windows"), evidence("macos")] };
const good = evaluateEdgeMediaPlaybackFieldUat(goodReport);
assert.equal(good.releaseReady, true);
assert.deepEqual(good.blockers, []);

for (const [name, report, blocker] of [
  ["missing_macos", { buildCommit: "abc1234", evidence: [evidence("windows")] }, "macos_evidence_required"],
  ["commit_mismatch", { buildCommit: "abc1234", evidence: [evidence("windows"), evidence("macos", "def5678")] }, "build_commit_mismatch"],
  ["offline", { buildCommit: "abc1234", evidence: [{ ...evidence("windows"), offlinePlayback: false }, evidence("macos")] }, "offline_playback_required"],
  ["projector", { buildCommit: "abc1234", evidence: [{ ...evidence("windows"), projectorChecked: false }, evidence("macos")] }, "projector_check_required"],
  ["blank_fixture_id", { buildCommit: "abc1234", evidence: [{ ...evidence("windows"), mediaFixtureIds: ["image-fixture", "", "audio-fixture"] }, evidence("macos")] }, "media_fixtures_required"],
  ["contribution", { buildCommit: "abc1234", evidence: [evidence("windows"), { ...evidence("macos"), contributionAvChecked: false }] }, "contribution_av_required"],
  ["restart", { buildCommit: "abc1234", evidence: [evidence("windows"), { ...evidence("macos"), dynamicRestartNoAutoResume: false }] }, "dynamic_restart_no_auto_resume_required"],
  ["missing_video_measurement", { buildCommit: "abc1234", evidence: [{ ...evidence("windows"), videoDriftMs: null }, evidence("macos")] }, "video_drift_measurement_required"],
  ["blank_av_measurement", { buildCommit: "abc1234", evidence: [evidence("windows"), { ...evidence("macos"), contributionAvSkewMs: "" }] }, "contribution_av_skew_measurement_required"],
  ["video_drift", { buildCommit: "abc1234", evidence: [{ ...evidence("windows"), videoDriftMs: 251 }, evidence("macos")] }, "video_drift_above_250ms"],
  ["av_skew", { buildCommit: "abc1234", evidence: [evidence("windows"), { ...evidence("macos"), contributionAvSkewMs: 121 }] }, "contribution_av_skew_above_120ms"]
]) {
  const result = evaluateEdgeMediaPlaybackFieldUat(report);
  assert.equal(result.releaseReady, false, name);
  assert.ok(result.blockers.includes(blocker), `${name} missing blocker ${blocker}`);
}

const template = createEdgeMediaPlaybackFieldUatTemplate("abc1234");
assert.equal(template.evidence.length, 2);
assert.equal(evaluateEdgeMediaPlaybackFieldUat(template).releaseReady, false);

const temp = mkdtempSync(path.join(tmpdir(), "ipresenter-media-uat-"));
const templatePath = path.join(temp, "template.json");
const init = spawnSync(process.execPath, [cliPath, "--init", templatePath, "abc1234"], { encoding: "utf8" });
assert.equal(init.status, 0, init.stderr || init.stdout);
const fromDisk = JSON.parse(await readFile(templatePath, "utf8"));
assert.equal(fromDisk.buildCommit, "abc1234");
assert.equal(fromDisk.evidence.length, 2);

const goodPath = path.join(temp, "good.json");
writeFileSync(goodPath, JSON.stringify(goodReport));
const cli = spawnSync(process.execPath, [cliPath, goodPath], { encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
assert.equal(JSON.parse(cli.stdout).releaseReady, true);
console.log(JSON.stringify({ ok: true, physicalPlatforms: ["windows", "macos"], videoDriftTargetMs: 250, contributionAvSkewTargetMs: 120 }));
