const REQUIRED_PLATFORMS = ["windows", "macos"];
const VIDEO_DRIFT_LIMIT_MS = 250;
const CONTRIBUTION_AV_SKEW_LIMIT_MS = 120;

function unique(values) {
  return [...new Set(values)];
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createEdgeMediaPlaybackFieldUatTemplate(buildCommit = "") {
  const commit = text(buildCommit);
  return {
    buildCommit: commit,
    evidence: REQUIRED_PLATFORMS.map((platform) => ({
      platform,
      buildCommit: commit,
      device: "",
      projector: "",
      mediaFixtureIds: [],
      status: "pending",
      offlinePlayback: false,
      projectorChecked: false,
      contributionAvChecked: false,
      clearToScripture: false,
      dynamicRestartNoAutoResume: false,
      videoDriftMs: null,
      contributionAvSkewMs: null,
      notes: ""
    }))
  };
}

export function evaluateEdgeMediaPlaybackFieldUat(report) {
  const blockers = [];
  const expectedCommit = text(report?.buildCommit);
  const evidence = Array.isArray(report?.evidence) ? report.evidence : [];

  if (!expectedCommit) blockers.push("build_commit_required");

  for (const platform of REQUIRED_PLATFORMS) {
    const item = evidence.find((candidate) => text(candidate?.platform).toLowerCase() === platform);
    if (!item) {
      blockers.push(`${platform}_evidence_required`);
      continue;
    }

    if (!text(item.device)) blockers.push("device_evidence_required");
    if (!text(item.projector)) blockers.push("projector_check_required");
    if (!Array.isArray(item.mediaFixtureIds) || item.mediaFixtureIds.length < 3)
      blockers.push("media_fixtures_required");
    if (text(item.status).toLowerCase() !== "pass") blockers.push("pending_or_failed_cases");
    if (!text(item.buildCommit) || (expectedCommit && text(item.buildCommit) !== expectedCommit))
      blockers.push("build_commit_mismatch");
    if (item.offlinePlayback !== true) blockers.push("offline_playback_required");
    if (item.projectorChecked !== true) blockers.push("projector_check_required");
    if (item.contributionAvChecked !== true) blockers.push("contribution_av_required");
    if (item.clearToScripture !== true) blockers.push("clear_to_scripture_required");
    if (item.dynamicRestartNoAutoResume !== true) blockers.push("dynamic_restart_no_auto_resume_required");

    const videoDrift = Number(item.videoDriftMs);
    if (!Number.isFinite(videoDrift) || videoDrift < 0 || videoDrift > VIDEO_DRIFT_LIMIT_MS)
      blockers.push("video_drift_above_250ms");
    const avSkew = Number(item.contributionAvSkewMs);
    if (!Number.isFinite(avSkew) || avSkew < 0 || avSkew > CONTRIBUTION_AV_SKEW_LIMIT_MS)
      blockers.push("contribution_av_skew_above_120ms");
  }

  const normalized = unique(blockers);
  return {
    releaseReady: normalized.length === 0,
    blockers: normalized,
    requiredPlatforms: [...REQUIRED_PLATFORMS],
    videoDriftLimitMs: VIDEO_DRIFT_LIMIT_MS,
    contributionAvSkewLimitMs: CONTRIBUTION_AV_SKEW_LIMIT_MS
  };
}
