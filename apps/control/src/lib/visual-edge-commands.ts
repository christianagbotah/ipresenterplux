import type { PoolClient } from "pg";
import { VISUAL_SOURCE_TYPES } from "./visual-source-metadata.ts";

const VISUAL_COMMAND_TYPES = new Set([
  "visual.rescan",
  "visual.preview.select",
  "visual.preview.clear"
]);

export class VisualEdgeCommandError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VisualEdgeCommandError";
    this.status = status;
    this.code = code;
  }
}

export function requireVisualCommandService(type: string, requestedServiceId: string | null | undefined, activeServiceId: string | null) {
  const serviceId = requestedServiceId ?? activeServiceId;
  if (type !== "visual.preview.select" && type !== "visual.preview.clear") return serviceId ?? null;
  if (!serviceId) {
    throw new VisualEdgeCommandError(409, "visual_service_required", "An active service is required for visual Preview control");
  }
  if (!activeServiceId || activeServiceId !== serviceId) {
    throw new VisualEdgeCommandError(409, "visual_service_mismatch", "This Edge device is not assigned to the selected service");
  }
  return serviceId;
}

export function normalizeVisualCommandArguments(type: string, argumentsValue: Record<string, string>) {
  if (!VISUAL_COMMAND_TYPES.has(type)) return { ...argumentsValue };

  const keys = Object.keys(argumentsValue);
  if (type === "visual.preview.select") {
    if (keys.some((key) => key !== "sourceId")) {
      throw new VisualEdgeCommandError(400, "visual_command_arguments_invalid", "Preview selection accepts only sourceId");
    }
    const sourceId = argumentsValue.sourceId?.trim();
    if (!sourceId) {
      throw new VisualEdgeCommandError(400, "visual_source_required", "A visual source is required for Preview selection");
    }
    if (sourceId.length > 160) {
      throw new VisualEdgeCommandError(400, "visual_source_invalid", "Visual source id is too long");
    }
    return { sourceId };
  }

  if (keys.length) {
    throw new VisualEdgeCommandError(400, "visual_command_arguments_invalid", `${type} does not accept arguments`);
  }
  return {};
}

export async function requireVisualPreviewSourceForDevice(
  client: PoolClient,
  input: { organizationId: string; deviceId: string; sourceId: string }
) {
  const result = await client.query<{ id: string; source_key: string }>(
    `select id::text,source_key
       from media_sources
      where organization_id=$1
        and edge_device_id=$2
        and source_key=$3
        and source_type = any($4::text[])
      limit 1`,
    [input.organizationId, input.deviceId, input.sourceId, [...VISUAL_SOURCE_TYPES]]
  );
  const row = result.rows[0];
  if (!row) {
    throw new VisualEdgeCommandError(404, "visual_source_not_found", "Visual source was not found on this Edge device");
  }
  return { id: row.id, sourceKey: row.source_key };
}
