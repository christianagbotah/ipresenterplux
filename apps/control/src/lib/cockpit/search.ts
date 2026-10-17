import type { PoolClient } from "pg";
import { parseOperatorScriptureReference } from "../edge-operator-catalog.ts";
import { getCurrentServiceForUser } from "../current-service.ts";
import { BibleLibraryError, resolveLocalScripture } from "../bible-library.ts";
import { listMediaLibrary } from "../media-library.ts";
import { listVisualSources } from "../camera-sources.ts";

export type UniversalSearchGroupId = "scripture" | "songs" | "media" | "service" | "visual_sources" | "actions";

export type UniversalSearchItem = {
  id: string;
  group: UniversalSearchGroupId;
  title: string;
  subtitle: string | null;
  href: string | null;
  commandText: string | null;
};

export const UNIVERSAL_SEARCH_GROUPS: ReadonlyArray<{ id: UniversalSearchGroupId; label: string }> = [
  { id: "scripture", label: "Scripture" },
  { id: "songs", label: "Songs" },
  { id: "media", label: "Media" },
  { id: "service", label: "Service" },
  { id: "visual_sources", label: "Visual Sources" },
  { id: "actions", label: "Actions" }
];

export class CockpitSearchError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CockpitSearchError";
    this.status = status;
    this.code = code;
  }
}

type SearchInput = { query: string; limitPerGroup?: number; now?: Date };

type ServiceItemRow = { id: string; item_type: string; title: string; sort_order: number };

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function clampLimit(value: number | undefined) {
  const parsed = Number.isFinite(value) ? Math.trunc(value as number) : 5;
  return Math.max(1, Math.min(8, parsed || 5));
}

function shortText(value: string | null | undefined, max = 180) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function matchesQuery(query: string, ...values: Array<string | null | undefined>) {
  const needle = query.toLocaleLowerCase();
  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

function actionItems(query: string, capabilities: NonNullable<Awaited<ReturnType<typeof getCurrentServiceForUser>>>["capabilities"], canScripture: boolean, limit: number): UniversalSearchItem[] {
  const candidates: UniversalSearchItem[] = [
    ...(canScripture ? [{ id: "action:scripture", group: "actions" as const, title: "Open Scripture", subtitle: "Find or browse a passage", href: "/scripture", commandText: "open scripture" }] : []),
    ...(capabilities.canMedia ? [{ id: "action:media", group: "actions" as const, title: "Open Songs & Media", subtitle: "Browse church songs, slides and media", href: "/media", commandText: "open media" }] : []),
    ...(capabilities.canCameras ? [{ id: "action:visual-sources", group: "actions" as const, title: "Open Visual Sources", subtitle: "Cameras, screens and windows", href: "/cameras", commandText: "open visual sources" }] : []),
    ...(capabilities.canViewPlanner ? [{ id: "action:planner", group: "actions" as const, title: "Open Service Planner", subtitle: "Review the current service rundown", href: "/planner", commandText: "open planner" }] : []),
    ...(capabilities.canStreaming ? [{ id: "action:streaming-status", group: "actions" as const, title: "Check streaming status", subtitle: "Open current streaming health", href: "/streaming", commandText: "check streaming" }] : [])
  ];
  return candidates.filter((item) => matchesQuery(query, item.title, item.subtitle, item.commandText)).slice(0, limit);
}

export async function searchCockpit(
  client: PoolClient,
  actorUserId: string,
  input: SearchInput
): Promise<{ query: string; groups: Array<{ id: UniversalSearchGroupId; label: string; items: UniversalSearchItem[] }> }> {
  const query = normalizeQuery(input.query ?? "");
  if (!query) return { query: "", groups: [] };

  const limit = clampLimit(input.limitPerGroup);
  const context = await getCurrentServiceForUser(actorUserId, { client, now: input.now });
  if (!context) throw new CockpitSearchError(404, "cockpit_context_not_found", "Church workspace was not found");

  const buckets = new Map<UniversalSearchGroupId, UniversalSearchItem[]>();
  const corePresentation = context.entitlementFeatures["core.presentation"] === true;

  if (context.capabilities.canViewPlanner && corePresentation && parseOperatorScriptureReference(query)) {
    try {
      const scripture = await resolveLocalScripture(client, {
        reference: query,
        version: context.service?.activeBibleVersion ?? "WEBP"
      });
      buckets.set("scripture", [{
        id: `scripture:${scripture.version}:${scripture.bookCode}:${scripture.chapter}:${scripture.verseStart ?? "chapter"}:${scripture.verseEnd ?? "chapter"}`,
        group: "scripture",
        title: `${scripture.reference} · ${scripture.versionAbbreviation}`,
        subtitle: shortText(scripture.passageText),
        href: `/scripture?reference=${encodeURIComponent(scripture.reference)}&version=${encodeURIComponent(scripture.version)}`,
        commandText: null
      }]);
    } catch (error) {
      if (!(error instanceof BibleLibraryError)) throw error;
      buckets.set("scripture", []);
    }
  } else if (context.capabilities.canViewPlanner && corePresentation) {
    buckets.set("scripture", []);
  }

  if (context.capabilities.canMedia) {
    const [songs, media, slides] = await Promise.all([
      listMediaLibrary(client, actorUserId, { organizationId: context.organizationId, search: query, itemType: "song", limit, offset: 0 }),
      listMediaLibrary(client, actorUserId, { organizationId: context.organizationId, search: query, itemType: "media", limit, offset: 0 }),
      listMediaLibrary(client, actorUserId, { organizationId: context.organizationId, search: query, itemType: "slide", limit, offset: 0 })
    ]);
    buckets.set("songs", songs.items.slice(0, limit).map((item) => ({
      id: item.id,
      group: "songs",
      title: item.title,
      subtitle: "Song",
      href: `/media?item=${encodeURIComponent(item.id)}`,
      commandText: null
    })));
    buckets.set("media", [...media.items, ...slides.items].slice(0, limit).map((item) => ({
      id: item.id,
      group: "media",
      title: item.title,
      subtitle: item.itemType === "slide" ? "Slide" : "Media",
      href: `/media?item=${encodeURIComponent(item.id)}`,
      commandText: null
    })));
  }

  if (context.capabilities.canViewPlanner) {
    const serviceItems = context.service ? await client.query<ServiceItemRow>(
      `select id::text,item_type,title,sort_order
         from presentation_items
        where service_id=$1
          and state <> 'dismissed'
          and (title ilike $2 escape '\\' or content::text ilike $2 escape '\\')
        order by sort_order,id
        limit $3`,
      [context.service.id, `%${query.replace(/[\%_]/g, (character) => `\\${character}`)}%`, limit]
    ) : { rows: [] as ServiceItemRow[] };
    buckets.set("service", serviceItems.rows.map((item) => ({
      id: item.id,
      group: "service",
      title: item.title,
      subtitle: `${item.item_type.replaceAll("_", " ")} · Current service`,
      href: context.service ? `/planner/${encodeURIComponent(context.service.id)}?item=${encodeURIComponent(item.id)}` : "/planner",
      commandText: null
    })));
  }

  if (context.capabilities.canCameras) {
    const visuals = await listVisualSources(client, actorUserId, context.organizationId, { now: input.now });
    buckets.set("visual_sources", visuals.sources
      .filter((source) => matchesQuery(query, source.displayName, source.name, source.kind, source.processName, source.reportingDevice?.name))
      .slice(0, limit)
      .map((source) => ({
        id: source.id,
        group: "visual_sources",
        title: source.displayName,
        subtitle: `${source.kind === "display" ? "Screen" : source.kind[0].toUpperCase() + source.kind.slice(1)} · ${source.captureStatusLabel}`,
        href: `/cameras?source=${encodeURIComponent(source.id)}`,
        commandText: null
      })));
  }

  buckets.set("actions", actionItems(query, context.capabilities, context.capabilities.canViewPlanner && corePresentation, limit));

  const allowed = new Set<UniversalSearchGroupId>([
    ...(context.capabilities.canViewPlanner && corePresentation ? ["scripture" as const] : []),
    ...(context.capabilities.canMedia ? ["songs" as const, "media" as const] : []),
    ...(context.capabilities.canViewPlanner ? ["service" as const] : []),
    ...(context.capabilities.canCameras ? ["visual_sources" as const] : []),
    "actions"
  ]);

  return {
    query,
    groups: UNIVERSAL_SEARCH_GROUPS
      .filter((group) => allowed.has(group.id))
      .map((group) => ({ ...group, items: buckets.get(group.id) ?? [] }))
  };
}
