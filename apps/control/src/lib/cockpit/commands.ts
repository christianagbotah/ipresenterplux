import type { PoolClient } from "pg";
import { parseOperatorScriptureReference } from "../edge-operator-catalog.ts";
import { getCurrentServiceForUser } from "../current-service.ts";
import { createManualScriptureDetection } from "../manual-scripture.ts";
import { listMediaLibrary } from "../media-library.ts";
import { resolveLocalScripture } from "../bible-library.ts";
import { setCockpitRecommendationState, setServicePin } from "./recommendations.ts";

export const COCKPIT_INTENT_IDS = [
  "navigation.open",
  "scripture.search",
  "scripture.preview",
  "media.search",
  "media.open",
  "recommendation.pin",
  "recommendation.dismiss",
  "status.explain"
] as const;
export type CockpitIntentId = typeof COCKPIT_INTENT_IDS[number];

export type CockpitCommandContext = {
  organizationId: string;
  serviceId: string | null;
  defaultBibleVersion: string;
};

type IntentBase = { organizationId: string; serviceId: string | null };
export type CockpitIntent =
  | (IntentBase & { id: "navigation.open"; href: string })
  | (IntentBase & { id: "scripture.search"; reference: string; version: string })
  | (IntentBase & { id: "scripture.preview"; reference: string; version: string })
  | (IntentBase & { id: "media.search"; query: string })
  | (IntentBase & { id: "media.open"; itemId: string })
  | (IntentBase & { id: "recommendation.pin"; targetType: string; targetId: string; title: string; pinned: boolean })
  | (IntentBase & { id: "recommendation.dismiss"; recommendationId: string })
  | (IntentBase & { id: "status.explain"; capability: "streaming" | "translations" | "edge" });

export type CockpitCommandResolution =
  | { status: "ready"; intent: CockpitIntent; summary: string; consequential: boolean }
  | { status: "needs_confirmation"; intent: null; summary: string; consequential: true }
  | { status: "unknown"; intent: null; summary: string; consequential: false };

export type CockpitCommandResult =
  | { kind: "navigation"; href: string }
  | { kind: "scripture_search"; reference: string; version: string; passageText: string }
  | { kind: "prepared"; message: string; followUp: { type: "scripture_preview"; detectionId: string; reference: string } }
  | { kind: "media_search"; items: Array<{ id: string; title: string; itemType: string }> }
  | { kind: "updated"; message: string }
  | { kind: "status"; message: string; href: string };

export class CockpitCommandError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.name = "CockpitCommandError"; this.status = status; this.code = code;
  }
}

const NAVIGATION_ALIASES: Record<string, string> = {
  archive: "/archive", media: "/media", library: "/media", cameras: "/cameras", camera: "/cameras",
  scripture: "/scripture", streaming: "/streaming", audience: "/audience", translations: "/translations",
  translation: "/translations", settings: "/settings", planner: "/planner", plan: "/planner", "ai director": "/ai-director"
};
const CONSEQUENTIAL_PATTERN = /\b(start|stop|end|take|clear|go\s+live|broadcast|stream)\b/i;

function cleanText(text: string) { return text.trim().replace(/\s+/g, " ").slice(0, 400); }
function scriptureParts(raw: string, fallbackVersion: string) {
  const value = raw.trim();
  if (parseOperatorScriptureReference(value)) return { reference: value, version: fallbackVersion };
  const parts = value.split(" ");
  if (parts.length > 1) {
    const possibleVersion = parts.at(-1)!;
    const reference = parts.slice(0, -1).join(" ");
    if (/^[A-Za-z0-9-]{2,12}$/.test(possibleVersion) && parseOperatorScriptureReference(reference)) {
      return { reference, version: possibleVersion.toUpperCase() };
    }
  }
  return null;
}

export function resolveCockpitCommand(text: string, context: CockpitCommandContext): CockpitCommandResolution {
  const command = cleanText(text);
  if (!command) return { status: "unknown", intent: null, summary: "Type a Scripture, media search, navigation, or status command.", consequential: false };
  const lower = command.toLowerCase();

  if (/^(show|preview|prepare)\s+/i.test(command)) {
    const parsed = scriptureParts(command.replace(/^(show|preview|prepare)\s+/i, ""), context.defaultBibleVersion);
    if (parsed && context.serviceId) return {
      status: "ready",
      intent: { id: "scripture.preview", organizationId: context.organizationId, serviceId: context.serviceId, ...parsed },
      summary: `Prepare ${parsed.reference} (${parsed.version}) for Preview`, consequential: false
    };
  }
  if (/^(find|search)\s+/i.test(command)) {
    const query = command.replace(/^(find|search)\s+/i, "").trim();
    if (query) return { status: "ready", intent: { id: "media.search", organizationId: context.organizationId, serviceId: context.serviceId, query }, summary: `Search media for “${query}”`, consequential: false };
  }
  const statusMatch = lower.match(/(?:what(?:'s| is) wrong with|status of|check)\s+(streaming|translations?|edge)/i);
  if (statusMatch) {
    const capability = statusMatch[1].startsWith("translation") ? "translations" : statusMatch[1] === "edge" ? "edge" : "streaming";
    return { status: "ready", intent: { id: "status.explain", organizationId: context.organizationId, serviceId: context.serviceId, capability }, summary: `Explain ${capability} status`, consequential: false };
  }
  const navMatch = lower.match(/^open\s+(.+)$/);
  if (navMatch && NAVIGATION_ALIASES[navMatch[1]]) {
    const href = NAVIGATION_ALIASES[navMatch[1]];
    return { status: "ready", intent: { id: "navigation.open", organizationId: context.organizationId, serviceId: context.serviceId, href }, summary: `Open ${navMatch[1]}`, consequential: false };
  }
  if (CONSEQUENTIAL_PATTERN.test(command)) {
    return { status: "needs_confirmation", intent: null, summary: "That live mutation is not enabled in the command layer yet. Use the explicit live control.", consequential: true };
  }
  return { status: "unknown", intent: null, summary: "I could not map that to a registered iPresenterPlux command.", consequential: false };
}

async function authorize(client: PoolClient, actorUserId: string, intent: CockpitIntent, now: Date) {
  const context = await getCurrentServiceForUser(actorUserId, { client, organizationId: intent.organizationId, now });
  if (!context) throw new CockpitCommandError(404, "cockpit_context_not_found", "Church workspace was not found");
  if (intent.serviceId && context.service?.id !== intent.serviceId) throw new CockpitCommandError(409, "cockpit_service_changed", "The active service changed; interpret the command again");
  return context;
}

export async function executeCockpitIntent(client: PoolClient, actorUserId: string, intent: CockpitIntent | null, options: { now?: Date } = {}): Promise<CockpitCommandResult> {
  if (!intent) throw new CockpitCommandError(400, "cockpit_intent_missing", "A registered command intent is required");
  const now = options.now ? new Date(options.now) : new Date();
  const context = await authorize(client, actorUserId, intent, now);

  if (intent.id === "navigation.open") {
    const required = intent.href === "/streaming" ? context.capabilities.canStreaming
      : intent.href === "/translations" ? context.capabilities.canTranslations
      : intent.href === "/media" ? context.capabilities.canMedia
      : intent.href === "/cameras" ? context.capabilities.canCameras
      : intent.href === "/ai-director" ? context.capabilities.canAIDirector
      : intent.href === "/settings" ? context.capabilities.canSettings
      : intent.href === "/archive" ? context.capabilities.canArchive
      : context.capabilities.canViewPlanner;
    if (!required) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Your role or subscription does not allow that workspace");
    return { kind: "navigation", href: intent.href };
  }

  if (intent.id === "scripture.search") {
    if (!context.capabilities.canViewPlanner || context.entitlementFeatures["core.presentation"] !== true) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Scripture search is not available to this account");
    const resolved = await resolveLocalScripture(client, { reference: intent.reference, version: intent.version });
    return { kind: "scripture_search", reference: resolved.reference, version: resolved.version, passageText: resolved.passageText };
  }

  if (intent.id === "scripture.preview") {
    if (!context.capabilities.canLiveControl || context.entitlementFeatures["core.presentation"] !== true || !intent.serviceId) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Live Scripture preparation is not allowed for this account");
    const selection = await createManualScriptureDetection(client, { serviceId: intent.serviceId, reference: intent.reference, version: intent.version, actorId: actorUserId });
    return { kind: "prepared", message: `${selection.reference} is ready for operator Preview`, followUp: { type: "scripture_preview", detectionId: selection.id, reference: selection.reference } };
  }

  if (intent.id === "media.search") {
    if (!context.capabilities.canMedia) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Media search is not available to this account");
    const result = await listMediaLibrary(client, actorUserId, { organizationId: intent.organizationId, search: intent.query, limit: 12, offset: 0 });
    return { kind: "media_search", items: result.items.map((item) => ({ id: item.id, title: item.title, itemType: item.itemType })) };
  }

  if (intent.id === "media.open") {
    if (!context.capabilities.canMedia) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Media is not available to this account");
    return { kind: "navigation", href: `/media?item=${encodeURIComponent(intent.itemId)}` };
  }

  if (intent.id === "recommendation.pin") {
    if (!context.capabilities.canLiveControl || !intent.serviceId) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Live operator permission is required");
    await setServicePin(client, actorUserId, { organizationId: intent.organizationId, serviceId: intent.serviceId, targetType: intent.targetType, targetId: intent.targetId, title: intent.title, pinned: intent.pinned, now });
    return { kind: "updated", message: intent.pinned ? "Pinned to the top of Next" : "Removed from pinned Next" };
  }

  if (intent.id === "recommendation.dismiss") {
    if (!context.capabilities.canLiveControl) throw new CockpitCommandError(403, "cockpit_command_forbidden", "Live operator permission is required");
    await setCockpitRecommendationState(client, actorUserId, { recommendationId: intent.recommendationId, state: "dismissed", now });
    return { kind: "updated", message: "Recommendation dismissed" };
  }

  if (intent.id === "status.explain") {
    const allowed = intent.capability === "streaming" ? context.capabilities.canStreaming
      : intent.capability === "translations" ? context.capabilities.canTranslations
      : context.roles.length > 0;
    if (!allowed) throw new CockpitCommandError(403, "cockpit_command_forbidden", "That system status is not available to your role");
    const href = intent.capability === "streaming" ? "/streaming" : intent.capability === "translations" ? "/translations" : "/settings/devices";
    return { kind: "status", message: `Open ${intent.capability} for current health and recovery details.`, href };
  }

  throw new CockpitCommandError(400, "cockpit_intent_unknown", "Command intent is not registered");
}
