import { LIVE_OPERATOR_ROLES, STREAM_OPERATOR_ROLES } from "@/lib/rbac";

export const EDGE_COMMAND_TYPES = [
  "preview.prepare",
  "program.take",
  "program.clear",
  "output.start",
  "output.stop",
  "recording.start",
  "recording.stop",
  "stream.start",
  "stream.stop",
  "scene.select",
  "language-channel.set",
  "health.query"
] as const;

export type EdgeCommandType = (typeof EDGE_COMMAND_TYPES)[number];

const mediaCommands = new Set<EdgeCommandType>([
  "output.start",
  "output.stop",
  "recording.start",
  "recording.stop",
  "stream.start",
  "stream.stop",
  "scene.select"
]);

export function rolesForEdgeCommand(type: EdgeCommandType): readonly string[] {
  return mediaCommands.has(type) ? STREAM_OPERATOR_ROLES : LIVE_OPERATOR_ROLES;
}

export function sanitizeCommandError(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return normalized.length ? normalized.slice(0, 80) : null;
}
