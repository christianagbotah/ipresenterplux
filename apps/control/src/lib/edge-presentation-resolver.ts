import { createHash } from "node:crypto";

export type EdgePresentationQueryClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

export type EdgePresentationMediaDescriptor = {
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
};

export type EdgeResolvedPresentation = {
  itemId: string;
  serviceId: string;
  itemType: string;
  title: string;
  body: string;
  footer: string | null;
  metadata: Record<string, string>;
  media: EdgePresentationMediaDescriptor | null;
};

export class EdgePresentationResolverError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EdgePresentationResolverError";
  }
}

const MEDIA_KINDS = new Set(["image", "video", "audio"]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function presentationBody(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .trim()
    .slice(0, 12000);
}

function safeMetadata(value: unknown) {
  const input = asObject(value);
  const metadata: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input).slice(0, 16)) {
    const safeKey = compactText(key, 64);
    const safeValue = compactText(raw, 500);
    if (safeKey && safeValue) metadata[safeKey] = safeValue;
  }
  return metadata;
}

function approvedHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) {
    throw new EdgePresentationResolverError("media_source_unsafe", "Media source does not contain an approved HTTPS asset URL");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe");
    return url.toString();
  } catch {
    throw new EdgePresentationResolverError("media_source_unsafe", "Media source does not contain an approved HTTPS asset URL");
  }
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mediaDescriptor(row: any, source: any): EdgePresentationMediaDescriptor {
  const content = asObject(row.content);
  const config = asObject(source.public_config);
  const mediaKind = compactText(content.mediaKind, 16);
  if (!MEDIA_KINDS.has(mediaKind) || (typeof config.mediaKind === "string" && config.mediaKind !== mediaKind)) {
    throw new EdgePresentationResolverError("media_source_unsafe", "Media kind does not match approved source metadata");
  }
  const sourceId = compactText(content.sourceId, 64);
  if (!sourceId || sourceId !== String(source.id)) {
    throw new EdgePresentationResolverError("media_source_unsafe", "Media source identity is invalid");
  }
  const downloadUrl = approvedHttpsUrl(config.assetUrl);
  const trimStartSeconds = Math.max(0, finiteNumber(content.trimStartSeconds, 0));
  const rawTrimEnd = finiteNumber(content.trimEndSeconds, Number.NaN);
  const trimEndSeconds = Number.isFinite(rawTrimEnd) && rawTrimEnd > trimStartSeconds ? rawTrimEnd : null;
  const volume = Math.min(1, Math.max(0, finiteNumber(content.volume, 1)));
  const fit = content.fit === "cover" ? "cover" : "contain";
  const contentTypeHint = compactText(config.contentType, 120) || null;
  const assetVersion = createHash("sha256")
    .update(JSON.stringify({ sourceId, mediaKind, downloadUrl, contentTypeHint }))
    .digest("hex");
  return {
    sourceId,
    mediaKind: mediaKind as EdgePresentationMediaDescriptor["mediaKind"],
    downloadUrl,
    assetVersion,
    contentTypeHint,
    title: compactText(row.title, 200),
    trimStartSeconds,
    trimEndSeconds,
    loop: content.loop === true,
    volume,
    fit,
  };
}

export function presentationThemeContentVariant(itemType: string): "generic" | "scripture" | "song" | "announcement" {
  if (itemType === "scripture" || itemType === "song" || itemType === "announcement") return itemType;
  return "generic";
}

export async function resolveEdgePresentationItem(
  client: EdgePresentationQueryClient,
  input: { deviceId: string; organizationId: string; itemId: string }
): Promise<EdgeResolvedPresentation | null> {
  const presentation = await client.query(
    `/* edge_presentation_item */
     select pi.id::text as item_id,pi.service_id::text,pi.item_type,pi.title,pi.content
     from presentation_items pi
     join services s on s.id=pi.service_id
     join edge_devices d on d.id=$2
     where pi.id=$1 and s.organization_id=$3 and d.organization_id=$3
       and d.status='active' and d.active_service_id=pi.service_id
     limit 1`,
    [input.itemId, input.deviceId, input.organizationId]
  );

  const row = presentation.rows[0];
  if (row) {
    const content = asObject(row.content);
    const bodySource = [content.body, content.text, content.content].find((item) => typeof item === "string");
    const lines = Array.isArray(content.lines) ? content.lines.filter((item) => typeof item === "string").join("\n") : "";
    const footerSource = [content.footer, content.subtitle, content.author].find((item) => typeof item === "string");
    let media: EdgePresentationMediaDescriptor | null = null;
    if (row.item_type === "media") {
      const sourceId = compactText(content.sourceId, 64);
      const sourceResult = await client.query(
        `/* edge_media_source */
         select id::text,name,source_type,status,public_config
         from media_sources
         where id=$1 and organization_id=$2
         limit 1`,
        [sourceId, input.organizationId]
      );
      const source = sourceResult.rows[0];
      if (!source || source.source_type !== "media_file" || source.status !== "ready") {
        throw new EdgePresentationResolverError("media_source_unsafe", "Media source is not ready for Edge playback");
      }
      media = mediaDescriptor(row, source);
    }
    return {
      itemId: String(row.item_id),
      serviceId: String(row.service_id),
      itemType: compactText(row.item_type, 32),
      title: compactText(row.title, 200),
      body: presentationBody((bodySource as string | undefined) ?? lines),
      footer: compactText(footerSource, 500) || null,
      metadata: safeMetadata(content.metadata),
      media,
    };
  }

  const legacy = await client.query(
    `/* edge_legacy_scripture */
     select sd.id::text as item_id,sd.service_id::text,sd.scripture_reference,sd.bible_version,
            sd.book,sd.chapter,sd.verse_start,sd.verse_end,sd.source_text,
            coalesce((select string_agg(bv.text, ' ' order by bv.verse)
              from bible_books bb join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
              where bb.version_id=sd.bible_version and lower(bb.canonical_name)=lower(sd.book)
                and bv.chapter=sd.chapter and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))),sd.source_text) as passage_text
     from scripture_detections sd
     join services s on s.id=sd.service_id
     join edge_devices d on d.id=$2
     where sd.id=$1 and s.organization_id=$3 and d.organization_id=$3
       and d.status='active' and d.active_service_id=sd.service_id
     limit 1`,
    [input.itemId, input.deviceId, input.organizationId]
  );
  const scripture = legacy.rows[0];
  if (!scripture) return null;
  const verseLabel = scripture.verse_start === null
    ? ""
    : scripture.verse_end && scripture.verse_end !== scripture.verse_start
      ? `${scripture.verse_start}-${scripture.verse_end}`
      : String(scripture.verse_start);
  return {
    itemId: String(scripture.item_id),
    serviceId: String(scripture.service_id),
    itemType: "scripture",
    title: compactText(scripture.scripture_reference, 200),
    body: presentationBody(scripture.passage_text ?? scripture.source_text ?? ""),
    footer: compactText(scripture.bible_version, 32) || null,
    metadata: {
      book: compactText(scripture.book, 120),
      chapter: String(scripture.chapter),
      verses: verseLabel,
      bibleVersion: compactText(scripture.bible_version, 32),
    },
    media: null,
  };
}
