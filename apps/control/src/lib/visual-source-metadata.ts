export const VISUAL_SOURCE_TYPES = ["camera", "video_input", "video_capture", "display", "window"] as const;
export const VISUAL_CAPTURE_STATUSES = [
  "available",
  "busy",
  "permission_required",
  "disconnected",
  "unsupported",
  "error"
] as const;

export type VisualSourceKind = "camera" | "display" | "window";
export type VisualCaptureStatus = typeof VISUAL_CAPTURE_STATUSES[number];

export type SanitizedVisualSourceMetadata = {
  captureStatus?: VisualCaptureStatus;
  width?: number;
  height?: number;
  fps?: number;
  previewActive?: boolean;
  programActive?: boolean;
  framesCaptured?: number;
  droppedFrames?: number;
  errorCode?: string;
  processName?: string;
  displayPrimary?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
}

function parseBoundedInteger(value: unknown, min: number, max: number) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const numeric = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < min || numeric > max) return undefined;
  return numeric;
}

function parseText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

export function visualSourceKind(sourceType: string): VisualSourceKind | null {
  const normalized = sourceType.trim().toLowerCase();
  if (["camera", "video_input", "video_capture"].includes(normalized)) return "camera";
  if (normalized === "display") return "display";
  if (normalized === "window") return "window";
  return null;
}

export function sanitizeVisualSourceMetadata(value: unknown): SanitizedVisualSourceMetadata {
  const metadata = asObject(value);
  const result: SanitizedVisualSourceMetadata = {};

  if (typeof metadata.captureStatus === "string") {
    const status = metadata.captureStatus.trim().toLowerCase();
    if ((VISUAL_CAPTURE_STATUSES as readonly string[]).includes(status)) {
      result.captureStatus = status as VisualCaptureStatus;
    }
  }

  const width = parseBoundedInteger(metadata.width, 1, 16_384);
  const height = parseBoundedInteger(metadata.height, 1, 16_384);
  const fps = parseBoundedInteger(metadata.fps, 1, 240);
  const framesCaptured = parseBoundedInteger(metadata.framesCaptured, 0, Number.MAX_SAFE_INTEGER);
  const droppedFrames = parseBoundedInteger(metadata.droppedFrames, 0, Number.MAX_SAFE_INTEGER);
  const previewActive = parseBoolean(metadata.previewActive);
  const programActive = parseBoolean(metadata.programActive);
  const displayPrimary = parseBoolean(metadata.displayPrimary);
  const errorCode = parseText(metadata.errorCode, 120);
  const processName = parseText(metadata.processName, 160);

  if (width !== undefined) result.width = width;
  if (height !== undefined) result.height = height;
  if (fps !== undefined) result.fps = fps;
  if (previewActive !== undefined) result.previewActive = previewActive;
  if (programActive !== undefined) result.programActive = programActive;
  if (framesCaptured !== undefined) result.framesCaptured = framesCaptured;
  if (droppedFrames !== undefined) result.droppedFrames = droppedFrames;
  if (errorCode !== undefined) result.errorCode = errorCode;
  if (processName !== undefined) result.processName = processName;
  if (displayPrimary !== undefined) result.displayPrimary = displayPrimary;
  return result;
}

export function reportedVisualSourceName(metadata: unknown, storageName: string) {
  const reportedName = parseText(asObject(metadata).reportedName, 160);
  return reportedName ?? storageName;
}

export function visualCaptureStatusCopy(status: VisualCaptureStatus | null | undefined) {
  switch (status) {
    case "available": return "Available";
    case "busy": return "In use by another app";
    case "permission_required": return "Permission required";
    case "disconnected": return "Disconnected";
    case "unsupported": return "Not supported on this device";
    case "error": return "Capture error";
    default: return "Status unavailable";
  }
}
