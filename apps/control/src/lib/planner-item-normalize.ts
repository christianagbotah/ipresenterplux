import type { PoolClient } from "pg";
import { PLANNER_BODY_MAX } from "./planner-contracts.ts";
import {
  normalizeOperatorPresentationBody,
  normalizeOperatorText
} from "./edge-operator-catalog.ts";
import { PlannerItemError, parsePlannerItemInput } from "./planner-item-schemas.ts";
import { resolvePlannerScripture } from "./planner-scripture.ts";

export type PlannerNormalizedPresentation = {
  itemType: string;
  title: string;
  body: string;
  footer: string | null;
};

export type NormalizedPlannerItem = {
  title: string;
  content: Record<string, unknown>;
  presentation: PlannerNormalizedPresentation;
};

type NormalizeOptions = {
  defaultBibleVersion?: string | null;
};

type MediaSourceRow = {
  id: string;
  name: string;
  source_type: string;
  public_config: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertBodyLimit(value: string) {
  if (value.length > PLANNER_BODY_MAX) {
    throw new PlannerItemError("planner_body_too_long", `Presentation body exceeds ${PLANNER_BODY_MAX} characters`);
  }
  return normalizeOperatorPresentationBody(value);
}

async function loadMediaSource(client: PoolClient, organizationId: string, sourceId: string) {
  const result = await client.query<MediaSourceRow>(
    `select id::text,name,source_type,public_config
     from media_sources
     where id=$1 and organization_id=$2
     limit 1`,
    [sourceId, organizationId]
  );
  if (!result.rowCount) {
    throw new PlannerItemError("media_source_not_found", "Media source was not found");
  }
  return result.rows[0];
}

function approvedHttpsAssetUrl(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) {
    throw new PlannerItemError("media_source_unsafe", "Media source does not contain an approved HTTPS asset URL");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("unsafe scheme or credentials");
    }
    return url.toString();
  } catch {
    throw new PlannerItemError("media_source_unsafe", "Media source does not contain an approved HTTPS asset URL");
  }
}

export async function normalizePlannerItem(
  client: PoolClient,
  organizationId: string,
  itemType: string,
  input: unknown,
  options: NormalizeOptions = {}
): Promise<NormalizedPlannerItem> {
  const parsed = parsePlannerItemInput(itemType, input) as Record<string, unknown>;

  if (itemType === "scripture") {
    const version = String(parsed.version || options.defaultBibleVersion || "").trim();
    if (!version) {
      throw new PlannerItemError("scripture_version_required", "A Bible version is required");
    }
    const resolved = await resolvePlannerScripture(client, String(parsed.reference), version);
    const footer = normalizeOperatorText(parsed.footer, 500) || resolved.versionAbbreviation;
    const body = assertBodyLimit(resolved.passageText);
    return {
      title: resolved.reference,
      content: {
        reference: resolved.reference,
        version: resolved.version,
        book: resolved.book,
        bookCode: resolved.bookCode,
        chapter: resolved.chapter,
        verseStart: resolved.verseStart,
        verseEnd: resolved.verseEnd,
        passageText: body,
        body,
        footer
      },
      presentation: { itemType, title: resolved.reference, body, footer }
    };
  }

  if (itemType === "song") {
    const sections = (parsed.sections as Array<{ label: string; text: string }>).map((section) => ({
      label: normalizeOperatorText(section.label, 80),
      text: normalizeOperatorPresentationBody(section.text)
    }));
    const bodySource = sections.map((section) => `${section.label}\n${section.text}`).join("\n\n");
    const body = assertBodyLimit(bodySource);
    const title = String(parsed.title);
    const author = normalizeOperatorText(parsed.author, 500) || null;
    return {
      title,
      content: {
        title,
        author,
        sections,
        defaultSection: parsed.defaultSection ?? null,
        body,
        footer: author
      },
      presentation: { itemType, title, body, footer: author }
    };
  }

  if (itemType === "slide" || itemType === "announcement" || itemType === "custom") {
    const title = String(parsed.title);
    const normalizedBody = assertBodyLimit(String(parsed.body));
    const explicitFooter = normalizeOperatorText(parsed.footer, 500);
    const dateNote = itemType === "announcement" ? normalizeOperatorText(parsed.dateNote, 160) : "";
    const finalFooter = explicitFooter || dateNote || null;
    const style = typeof parsed.style === "string" ? parsed.style : "default";
    return {
      title,
      content: {
        title,
        body: normalizedBody,
        footer: finalFooter,
        style,
        ...(dateNote ? { dateNote } : {})
      },
      presentation: { itemType, title, body: normalizedBody, footer: finalFooter }
    };
  }

  if (itemType === "lower_third") {
    const title = String(parsed.primaryText);
    const secondary = normalizeOperatorText(parsed.secondaryText, 500) || null;
    const body = assertBodyLimit(title);
    return {
      title,
      content: {
        primaryText: title,
        secondaryText: secondary,
        durationSeconds: parsed.durationSeconds ?? null,
        body,
        footer: secondary
      },
      presentation: { itemType, title, body, footer: secondary }
    };
  }

  if (itemType === "media") {
    const sourceId = String(parsed.sourceId);
    const source = await loadMediaSource(client, organizationId, sourceId);
    const config = asObject(source.public_config);
    const assetUrl = approvedHttpsAssetUrl(config.assetUrl);
    const mediaKind = String(parsed.mediaKind);
    if (typeof config.mediaKind === "string" && config.mediaKind !== mediaKind) {
      throw new PlannerItemError("media_source_unsafe", "Media kind does not match the approved source metadata");
    }
    const title = String(parsed.title);
    const operatorNotes = normalizeOperatorText(parsed.operatorNotes, 1000) || null;
    return {
      title,
      content: {
        sourceId,
        sourceName: source.name,
        mediaKind,
        assetUrl,
        operatorNotes,
        body: "",
        footer: null
      },
      presentation: { itemType, title, body: "", footer: null }
    };
  }

  if (itemType === "camera") {
    const sourceId = String(parsed.sourceId);
    const source = await loadMediaSource(client, organizationId, sourceId);
    if (source.source_type !== "camera") {
      throw new PlannerItemError("media_source_not_found", "Camera source was not found");
    }
    const title = normalizeOperatorText(parsed.label, 160) || source.name;
    const operatorNote = normalizeOperatorText(parsed.operatorNote, 1000) || null;
    return {
      title,
      content: {
        sourceId,
        sourceName: source.name,
        label: title,
        operatorNote,
        body: "",
        footer: null
      },
      presentation: { itemType, title, body: "", footer: null }
    };
  }

  throw new PlannerItemError("planner_item_type_invalid", "Planner item type is not supported");
}
