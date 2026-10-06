const YOUTUBE_STREAM_STATES = new Set(["active", "created", "error", "inactive", "ready"]);
const YOUTUBE_HEALTH_STATES = new Set(["good", "ok", "bad", "noData"]);
const YOUTUBE_CONFIGURATION_ISSUE_TYPES = new Set([
  "audioBitrateHigh",
  "audioBitrateLow",
  "audioBitrateMismatch",
  "audioCodec",
  "audioCodecMismatch",
  "audioSampleRate",
  "audioSampleRateMismatch",
  "audioStereoMismatch",
  "audioTooManyChannels",
  "badContainer",
  "bitrateHigh",
  "bitrateLow",
  "framerateMismatch",
  "frameRateHigh",
  "gopMismatch",
  "gopSizeLong",
  "gopSizeOver",
  "gopSizeShort",
  "multipleAudioStreams",
  "multipleVideoStreams",
  "noAudioStream",
  "noVideoStream",
  "openGop",
  "resolutionMismatch",
  "videoBitrateMismatch",
  "videoCodec",
  "videoCodecMismatch",
  "videoIngestionStarved",
  "videoInterlaceMismatch",
  "videoProfileMismatch",
  "videoResolutionSuboptimal",
  "videoResolutionUnsupported"
]);

const HEALTH_MAP = Object.freeze({
  good: "healthy",
  ok: "warning",
  bad: "error",
  noData: "warning"
});

function safeIssues(issues) {
  if (!Array.isArray(issues)) return [];
  const result = [];
  for (const issue of issues) {
    const type = typeof issue?.type === "string" ? issue.type : "";
    if (!YOUTUBE_CONFIGURATION_ISSUE_TYPES.has(type) || result.includes(type)) continue;
    result.push(type);
    if (result.length >= 8) break;
  }
  return result;
}

function evidence(overrides = {}) {
  return {
    providerHealthState: "unverified",
    providerLiveState: "unknown",
    providerErrorCode: null,
    providerIssueCodes: [],
    ...overrides
  };
}

export function initialProviderEvidence(destinationType) {
  if (["youtube", "facebook", "tiktok", "tiktok_rtmp"].includes(destinationType)) {
    return evidence();
  }
  return evidence({ providerHealthState: "unsupported" });
}

export function normalizeYouTubeLiveStreamResponse(payload) {
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  if (!item || typeof item !== "object") {
    return evidence({
      providerHealthState: "error",
      providerErrorCode: "provider_stream_not_found"
    });
  }

  const rawStreamStatus = item?.status?.streamStatus;
  const streamStatus = YOUTUBE_STREAM_STATES.has(rawStreamStatus) ? rawStreamStatus : null;
  const rawHealthStatus = item?.status?.healthStatus?.status;
  const healthStatus = YOUTUBE_HEALTH_STATES.has(rawHealthStatus) ? rawHealthStatus : null;
  const providerLiveState = streamStatus === "active"
    ? "receiving"
    : streamStatus === "error"
      ? "error"
      : streamStatus
        ? "not_live"
        : "unknown";

  return evidence({
    providerHealthState: healthStatus ? HEALTH_MAP[healthStatus] : (streamStatus === "error" ? "error" : "unverified"),
    providerLiveState,
    providerErrorCode: streamStatus === "error" ? "provider_stream_error" : null,
    providerIssueCodes: safeIssues(item?.status?.healthStatus?.configurationIssues)
  });
}

function httpFailure(status) {
  if (status === 401) return "provider_auth_failed";
  if (status === 403) return "provider_api_forbidden";
  if (status === 404) return "provider_stream_not_found";
  if (status === 429) return "provider_quota_limited";
  if (status >= 500) return "provider_api_unavailable";
  return "provider_api_failed";
}

export async function fetchYouTubeLiveStreamEvidence({
  accessToken,
  streamId,
  fetchImpl = globalThis.fetch,
  signal
}) {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  const id = typeof streamId === "string" ? streamId.trim() : "";
  if (!token) return evidence({ providerHealthState: "error", providerErrorCode: "provider_auth_missing" });
  if (!id) return evidence({ providerHealthState: "error", providerErrorCode: "provider_stream_id_missing" });
  if (typeof fetchImpl !== "function") return evidence({ providerHealthState: "error", providerErrorCode: "provider_api_unavailable" });

  const url = new URL("https://www.googleapis.com/youtube/v3/liveStreams");
  url.searchParams.set("part", "status");
  url.searchParams.set("id", id);

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      },
      signal
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
    return evidence({
      providerHealthState: "error",
      providerErrorCode: timedOut ? "provider_api_timeout" : "provider_api_unavailable"
    });
  }

  if (!response?.ok) {
    return evidence({
      providerHealthState: "error",
      providerErrorCode: httpFailure(Number(response?.status) || 0)
    });
  }

  try {
    return normalizeYouTubeLiveStreamResponse(await response.json());
  } catch {
    return evidence({
      providerHealthState: "error",
      providerErrorCode: "provider_api_invalid_response"
    });
  }
}

export const providerHealthConstants = Object.freeze({
  youtubeIssueTypes: Object.freeze([...YOUTUBE_CONFIGURATION_ISSUE_TYPES])
});
