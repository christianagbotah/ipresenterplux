import { createHash } from "node:crypto";
import { normalizeOperatorPresentationBody, normalizeOperatorText } from "./edge-operator-catalog.ts";

export type EdgeOperatorLibraryQueryClient = {
  query: <T extends object = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type EdgeOperatorLibraryRow = {
  id: string;
  item_type: "song" | "slide" | "media";
  title: string;
  planner_input: unknown;
  media_source_id: string | null;
  updated_at: string;
  source_name: string | null;
  source_type: string | null;
  source_status: string | null;
};

type ResolvedLibraryRow = EdgeOperatorLibraryRow & {
  organization_id: string;
  source_public_config: unknown;
};

export type EdgeOperatorLibrarySummary = {
  itemId: string;
  itemType: string;
  title: string;
  body: string;
  footer: string | null;
  metadata: Record<string, string>;
};

export type EdgeOperatorResolvedLibraryItem = EdgeOperatorLibrarySummary & {
  media: {
    sourceId: string;
    mediaKind: "image" | "video" | "audio";
    downloadUrl: string;
    assetVersion: string;
    contentTypeHint: string | null;
    title: string;
    trimStartSeconds: number;
    trimEndSeconds: number | null;
    loop: boolean;
    volume: number;
    fit: "contain" | "cover";
  } | null;
};

export class EdgeOperatorLibraryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EdgeOperatorLibraryError";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function summaryMetadata(row: EdgeOperatorLibraryRow, input: Record<string, unknown>) {
  const metadata: Record<string, string> = { library: "true" };
  if (row.item_type === "media") {
    const mediaKind = normalizeOperatorText(input.mediaKind, 16);
    if (mediaKind) metadata.mediaKind = mediaKind;
    if (row.source_status) metadata.sourceStatus = normalizeOperatorText(row.source_status, 32);
    if (row.source_name) metadata.sourceName = normalizeOperatorText(row.source_name, 160);
  }
  return metadata;
}

export function normalizeEdgeOperatorLibrarySummary(row: EdgeOperatorLibraryRow): EdgeOperatorLibrarySummary {
  const input = asObject(row.planner_input);
  const itemType = normalizeOperatorText(row.item_type, 32);
  const title = normalizeOperatorText(row.title, 200);
  let body = "";
  let footer: string | null = null;

  if (itemType === "song") {
    const sections = Array.isArray(input.sections) ? input.sections.slice(0, 64) : [];
    body = normalizeOperatorPresentationBody(sections.map((candidate) => {
      const section = asObject(candidate);
      const label = normalizeOperatorText(section.label, 80);
      const text = typeof section.text === "string" ? normalizeOperatorPresentationBody(section.text) : "";
      return [label, text].filter(Boolean).join("\n");
    }).filter(Boolean).join("\n\n"));
    footer = normalizeOperatorText(input.author, 500) || null;
  } else if (itemType === "slide") {
    body = typeof input.body === "string" ? normalizeOperatorPresentationBody(input.body) : "";
    footer = normalizeOperatorText(input.footer, 500) || null;
  } else if (itemType === "media") {
    body = "";
  } else {
    throw new EdgeOperatorLibraryError("library_item_type_invalid", "Library item type is not supported by Edge");
  }

  if (!title || (itemType !== "media" && !body)) {
    throw new EdgeOperatorLibraryError("library_item_invalid", "Library item is incomplete");
  }
  return {
    itemId: normalizeOperatorText(row.id, 128),
    itemType,
    title,
    body,
    footer,
    metadata: summaryMetadata(row, input),
  };
}

function approvedHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) {
    throw new EdgeOperatorLibraryError("media_source_unsafe", "Media source does not contain an approved HTTPS asset URL");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe");
    return url.toString();
  } catch {
    throw new EdgeOperatorLibraryError("media_source_unsafe", "Media source does not contain an approved HTTPS asset URL");
  }
}

export async function resolveEdgeOperatorLibraryItem(
  client: EdgeOperatorLibraryQueryClient,
  organizationId: string,
  itemId: string,
): Promise<EdgeOperatorResolvedLibraryItem | null> {
  const result = await client.query<ResolvedLibraryRow>(
    `/* edge_operator_library_item */
     select mli.id::text,mli.organization_id::text,mli.item_type,mli.title,mli.planner_input,
            mli.media_source_id::text,mli.updated_at::text,
            ms.name as source_name,ms.source_type,ms.status as source_status,ms.public_config as source_public_config
     from media_library_items mli
     left join media_sources ms on ms.id=mli.media_source_id and ms.organization_id=mli.organization_id
     where mli.id=$1 and mli.organization_id=$2
     limit 1`,
    [itemId, organizationId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const summary = normalizeEdgeOperatorLibrarySummary(row);
  if (row.item_type !== "media") return { ...summary, media: null };

  const input = asObject(row.planner_input);
  const config = asObject(row.source_public_config);
  const sourceId = normalizeOperatorText(input.sourceId, 64);
  const mediaKind = normalizeOperatorText(input.mediaKind, 16);
  if (!row.media_source_id || sourceId !== row.media_source_id ||
      !["image", "video", "audio"].includes(mediaKind) || row.source_status !== "ready") {
    throw new EdgeOperatorLibraryError("media_source_unsafe", "Library media source is not ready for Edge playback");
  }
  if (typeof config.mediaKind === "string" && config.mediaKind !== mediaKind) {
    throw new EdgeOperatorLibraryError("media_source_unsafe", "Media kind does not match approved source metadata");
  }

  const downloadUrl = approvedHttpsUrl(config.assetUrl);
  const contentTypeHint = normalizeOperatorText(config.contentType, 120) || null;
  const assetVersion = createHash("sha256")
    .update(JSON.stringify({ sourceId, mediaKind, downloadUrl, contentTypeHint }))
    .digest("hex");

  return {
    ...summary,
    media: {
      sourceId,
      mediaKind: mediaKind as "image" | "video" | "audio",
      downloadUrl,
      assetVersion,
      contentTypeHint,
      title: summary.title,
      trimStartSeconds: 0,
      trimEndSeconds: null,
      loop: false,
      volume: 1,
      fit: "contain",
    },
  };
}
