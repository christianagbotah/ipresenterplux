const REQUIRED_PLATFORMS = ["windows", "macos"] as const;
const VIDEO_DRIFT_LIMIT_MS = 250;
const CONTRIBUTION_AV_SKEW_LIMIT_MS = 120;

type FieldUatRecord = Record<string, unknown>;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): FieldUatRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as FieldUatRecord)
    : null;
}

function measuredNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

export function evaluateEdgeMediaPlaybackFieldUat(report: unknown) {
  const blockers: string[] = [];
  const reportRecord = asRecord(report);
  const expectedCommit = text(reportRecord?.buildCommit);
  const evidenceValue = reportRecord?.evidence;
  const evidence: unknown[] = Array.isArray(evidenceValue) ? evidenceValue : [];

  if (!expectedCommit) blockers.push("build_commit_required");

  for (const platform of REQUIRED_PLATFORMS) {
    const item = evidence
      .map((candidate) => asRecord(candidate))
      .find((candidate) => text(candidate?.platform).toLowerCase() === platform);
    if (!item) {
      blockers.push(`${platform}_evidence_required`);
      continue;
    }

    if (!text(item.device)) blockers.push("device_evidence_required");
    if (!text(item.projector)) blockers.push("projector_check_required");
    const mediaFixtureIds = Array.isArray(item.mediaFixtureIds)
      ? unique(item.mediaFixtureIds.map((value) => text(value)).filter(Boolean))
      : [];
    if (mediaFixtureIds.length < 3) blockers.push("media_fixtures_required");
    if (text(item.status).toLowerCase() !== "pass") blockers.push("pending_or_failed_cases");
    if (!text(item.buildCommit) || (expectedCommit && text(item.buildCommit) !== expectedCommit))
      blockers.push("build_commit_mismatch");
    if (item.offlinePlayback !== true) blockers.push("offline_playback_required");
    if (item.projectorChecked !== true) blockers.push("projector_check_required");
    if (item.contributionAvChecked !== true) blockers.push("contribution_av_required");
    if (item.clearToScripture !== true) blockers.push("clear_to_scripture_required");
    if (item.dynamicRestartNoAutoResume !== true) blockers.push("dynamic_restart_no_auto_resume_required");

    const videoDrift = measuredNumber(item.videoDriftMs);
    if (videoDrift === null) blockers.push("video_drift_measurement_required");
    else if (videoDrift < 0 || videoDrift > VIDEO_DRIFT_LIMIT_MS) blockers.push("video_drift_above_250ms");
    const avSkew = measuredNumber(item.contributionAvSkewMs);
    if (avSkew === null) blockers.push("contribution_av_skew_measurement_required");
    else if (avSkew < 0 || avSkew > CONTRIBUTION_AV_SKEW_LIMIT_MS) blockers.push("contribution_av_skew_above_120ms");
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
