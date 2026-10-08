import type { PoolClient } from "pg";
import { getCurrentServiceForUser } from "../current-service.ts";
import type {
  CockpitFreshness,
  CockpitStageState,
  CockpitViewModel
} from "./contracts.ts";
import { projectPredictiveNext } from "./predictive-next.ts";
import { loadCockpitAttention } from "./attention.ts";

const FRESHNESS_MS = 120_000;

type PresentationRow = {
  id: string;
  item_type: string;
  title: string;
  state: "queued" | "preview" | "live" | "played" | "dismissed";
  sort_order: number;
  updated_at: string;
};

type ScriptureRow = {
  id: string;
  scripture_reference: string;
  state: string;
  confidence: string | number;
  source_observed_at: string;
  bible_version: string;
  passage_text: string | null;
};

type TranscriptRow = {
  text: string;
  source_observed_at: string;
  source_language: string | null;
  speaker_id: string | null;
  speaker_source: string;
  asr_confidence: number | null;
};

type SourceRow = {
  id: string;
  name: string;
  source_type: string;
  status: string;
  last_seen_at: string | null;
};

type EdgeRow = {
  id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
};

type OutputSummaryRow = { total: string | number; enabled: string | number; healthy: string | number; degraded: string | number };
type LanguageSummaryRow = { enabled: string | number; listeners: string | number };

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function freshness(lastSeenAt: string | null, now: Date): CockpitFreshness {
  const seen = timestamp(lastSeenAt);
  if (!seen) return "unavailable";
  return now.getTime() - seen.getTime() <= FRESHNESS_MS ? "current" : "stale";
}

function newestSource(rows: SourceRow[], types: Set<string>) {
  const matches = rows.filter((row) => types.has(row.source_type));
  const sorted = matches.slice().sort((left, right) => {
    const a = timestamp(left.last_seen_at)?.getTime() ?? 0;
    const b = timestamp(right.last_seen_at)?.getTime() ?? 0;
    return b - a;
  });
  return { count: matches.length, row: sorted[0] ?? null };
}

function stageFromPresentation(row: PresentationRow | undefined): CockpitStageState | null {
  if (!row || (row.state !== "preview" && row.state !== "live")) return null;
  return {
    id: row.id,
    source: "presentation_item",
    contentType: row.item_type,
    title: row.title,
    state: row.state,
    observedAt: row.updated_at,
    detail: null,
    body: null
  };
}

function stageFromScripture(row: ScriptureRow | undefined): CockpitStageState | null {
  if (!row || (row.state !== "preview" && row.state !== "live")) return null;
  return {
    id: row.id,
    source: "scripture_detection",
    contentType: "scripture",
    title: row.scripture_reference,
    state: row.state,
    observedAt: row.source_observed_at,
    detail: row.bible_version,
    body: row.passage_text
  };
}

function newestStage(...items: Array<CockpitStageState | null>) {
  return items.filter((item): item is CockpitStageState => Boolean(item)).sort((left, right) => {
    const a = timestamp(left.observedAt)?.getTime() ?? 0;
    const b = timestamp(right.observedAt)?.getTime() ?? 0;
    return b - a;
  })[0] ?? null;
}

export async function getCockpitViewModel(
  client: PoolClient,
  userId: string,
  options: { organizationId?: string; now?: Date } = {}
): Promise<CockpitViewModel> {
  const now = options.now ? new Date(options.now) : new Date();
  const context = await getCurrentServiceForUser(userId, {
    client,
    organizationId: options.organizationId,
    now
  });
  if (!context) {
    throw new Error("Cockpit organization context was not found");
  }

  const serviceId = context.service?.id ?? null;
  const organizationId = context.organizationId;
  const presentationResult = serviceId
    ? await client.query<PresentationRow>(
        `select id::text,item_type,title,state,sort_order,updated_at::text
           from presentation_items
          where service_id=$1 and state <> 'dismissed'
          order by sort_order,id`,
        [serviceId]
      )
    : { rows: [] as PresentationRow[] };
  const scriptureResult = serviceId
    ? await client.query<ScriptureRow>(
        `select sd.id::text,sd.scripture_reference,sd.state,sd.confidence,sd.bible_version,sd.source_observed_at::text,
                (
                  select string_agg(bv.text, ' ' order by bv.verse)
                  from bible_books bb
                  join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
                  where bb.version_id=sd.bible_version
                    and lower(bb.canonical_name)=lower(sd.book)
                    and bv.chapter=sd.chapter
                    and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))
                ) as passage_text
           from scripture_detections sd
          where sd.service_id=$1 and sd.state <> 'dismissed'
          order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc`,
        [serviceId]
      )
    : { rows: [] as ScriptureRow[] };
  const transcriptResult = serviceId
    ? await client.query<TranscriptRow>(
        `select text,source_observed_at::text,source_language,speaker_id,speaker_source,asr_confidence
           from transcript_segments
          where service_id=$1
          order by source_observed_at desc,created_at desc,id desc
          limit 1`,
        [serviceId]
      )
    : { rows: [] as TranscriptRow[] };
  const sourceResult = await client.query<SourceRow>(
    `select id::text,name,source_type,status,last_seen_at::text
       from media_sources
      where organization_id=$1
      order by last_seen_at desc nulls last,id`,
    [organizationId]
  );
  const edgeResult = await client.query<EdgeRow>(
    `select id::text,name,status,last_seen_at::text
       from edge_devices
      where organization_id=$1
        and ($2::uuid is null or active_service_id=$2::uuid or active_service_id is null)
      order by case when active_service_id=$2::uuid then 0 else 1 end,last_seen_at desc nulls last,id
      limit 1`,
    [organizationId, serviceId]
  );
  const outputResult = await client.query<OutputSummaryRow>(
    `select count(*)::int as total,
            count(*) filter (where enabled)::int as enabled,
            count(*) filter (where enabled and status in ('ready','live','connected','configured'))::int as healthy,
            count(*) filter (where enabled and status not in ('ready','live','connected','configured'))::int as degraded
       from output_destinations where organization_id=$1`,
    [organizationId]
  );
  const languageResult = await client.query<LanguageSummaryRow>(
    `select count(*) filter (where enabled)::int as enabled,
            coalesce(sum(listener_count) filter (where enabled),0)::int as listeners
       from language_channels where organization_id=$1`,
    [organizationId]
  );

  const presentationPreview = presentationResult.rows.find((row) => row.state === "preview");
  const presentationProgram = presentationResult.rows.find((row) => row.state === "live");
  const scripturePreview = scriptureResult.rows.find((row) => row.state === "preview");
  const scriptureProgram = scriptureResult.rows.find((row) => row.state === "live");
  const preview = newestStage(stageFromPresentation(presentationPreview), stageFromScripture(scripturePreview));
  const program = newestStage(stageFromPresentation(presentationProgram), stageFromScripture(scriptureProgram));
  const transcript = transcriptResult.rows[0] ?? null;
  const camera = newestSource(sourceResult.rows, new Set(["camera", "video_input", "video_capture"]));
  const audio = newestSource(sourceResult.rows, new Set(["audio_input"]));
  const edge = edgeResult.rows[0] ?? null;
  const outputs = outputResult.rows[0] ?? { total: 0, enabled: 0, healthy: 0, degraded: 0 };
  const languages = languageResult.rows[0] ?? { enabled: 0, listeners: 0 };

  const next = serviceId
    ? await projectPredictiveNext(client, { organizationId, serviceId, now })
    : [];
  const attention = serviceId
    ? await loadCockpitAttention(client, { organizationId, serviceId, serviceLive: context.service?.status === "live", now })
    : [];

  return {
    roles: [...context.roles],
    organization: { id: organizationId, name: context.organizationName },
    service: context.service ? {
      id: context.service.id,
      title: context.service.title,
      status: context.service.status,
      campusId: context.service.campusId,
      campusName: context.service.campusName,
      activeBibleVersion: context.service.activeBibleVersion,
      aiEnabled: context.service.aiEnabled,
      autoPreviewThreshold: context.service.autoPreviewThreshold
    } : null,
    capabilities: context.capabilities,
    program,
    preview,
    now: {
      speakerId: transcript?.speaker_id ?? null,
      speakerSource: transcript?.speaker_source ?? null,
      transcriptText: transcript?.text ?? null,
      sourceLanguage: transcript?.source_language ?? null,
      asrConfidence: transcript?.asr_confidence ?? null,
      observedAt: transcript?.source_observed_at ?? null,
      currentContent: program
    },
    next,
    attention,
    systems: {
      edge: {
        id: edge?.id ?? null,
        name: edge?.name ?? null,
        status: edge?.status ?? null,
        lastSeenAt: edge?.last_seen_at ?? null,
        freshness: freshness(edge?.last_seen_at ?? null, now)
      },
      camera: {
        count: camera.count,
        activeName: camera.row?.name ?? null,
        lastSeenAt: camera.row?.last_seen_at ?? null,
        freshness: freshness(camera.row?.last_seen_at ?? null, now)
      },
      audio: {
        count: audio.count,
        activeName: audio.row?.name ?? null,
        lastSeenAt: audio.row?.last_seen_at ?? null,
        freshness: freshness(audio.row?.last_seen_at ?? null, now)
      },
      outputs: {
        total: Number(outputs.total),
        enabled: Number(outputs.enabled),
        healthy: Number(outputs.healthy),
        degraded: Number(outputs.degraded)
      },
      languages: {
        enabled: Number(languages.enabled),
        listeners: Number(languages.listeners)
      },
      audience: {
        listeners: Number(languages.listeners),
        serviceLive: context.service?.status === "live"
      }
    },
    authority: {
      programMutation: "existing_domain_paths_only",
      edgeOwnsPhysicalTruth: true
    }
  };
}
