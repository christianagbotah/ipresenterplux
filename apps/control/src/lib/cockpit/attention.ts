import type { PoolClient } from "pg";
import type { CockpitAttentionItem } from "./contracts.ts";

const FRESHNESS_MS = 120_000;

type WorkerTruth = {
  provider: string;
  state: string;
  errorCode: string | null;
  observedAt: string | null;
};

type StreamTruth = {
  name: string;
  destinationType: string;
  status: string;
  providerHealthState: string;
  providerLiveState: string;
  observedAt: string | null;
  errorCode: string | null;
  issueCodes: string[];
};

export type CockpitAttentionInput = {
  now?: Date;
  serviceLive: boolean;
  edge: null | { name: string; status: string; lastSeenAt: string | null };
  asr: null | { name: string; status: string; lastSeenAt: string | null; workerStatus: string | null; engine: string | null };
  translation: { languages: string[]; worker: WorkerTruth | null };
  tts: { languages: string[]; worker: WorkerTruth | null };
  streamDestinations: StreamTruth[];
  subscription: null | { status: string; expiresAt: string | null; graceUntil: string | null };
};

function dateMs(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function fresh(value: string | null | undefined, now: Date) {
  const time = dateMs(value);
  return time !== null && time <= now.getTime() + 5_000 && now.getTime() - time <= FRESHNESS_MS;
}

function isoPlus(value: string | null | undefined, milliseconds = FRESHNESS_MS) {
  const time = dateMs(value);
  return time === null ? null : new Date(time + milliseconds).toISOString();
}

function languageLabel(languages: string[]) {
  if (languages.length <= 2) return languages.join(" and ");
  return `${languages.slice(0, 2).join(", ")} +${languages.length - 2} more`;
}

function safeCapability(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "destination";
}

function workerHealthy(worker: WorkerTruth | null, now: Date) {
  return Boolean(worker && worker.state === "ready" && fresh(worker.observedAt, now));
}

export function buildCockpitAttention(input: CockpitAttentionInput): CockpitAttentionItem[] {
  const now = input.now ? new Date(input.now) : new Date();
  const items: CockpitAttentionItem[] = [];

  if (input.edge) {
    const current = fresh(input.edge.lastSeenAt, now);
    const healthy = input.edge.status === "active" && current;
    if (!healthy) {
      items.push({
        id: "edge-health",
        severity: input.serviceLive ? "critical" : "warning",
        affectedCapability: "edge",
        impact: `${input.edge.name} is ${current ? input.edge.status : "not reporting fresh telemetry"}. Local camera, audio and projector control cannot be confirmed.`,
        containment: "Cloud service state remains available; any current physical Program may continue, but Edge output is not confirmed.",
        recommendedAction: "Open Edge Devices and reconnect or verify the production computer.",
        detailHref: "/settings/devices",
        observedAt: input.edge.lastSeenAt,
        freshUntil: isoPlus(input.edge.lastSeenAt),
        recoveryIntent: "navigation.open:/settings/devices"
      });
    }
  }

  if (input.asr) {
    const sourceFresh = fresh(input.asr.lastSeenAt, now);
    const sourceReady = ["ready", "live"].includes(input.asr.status);
    const workerReady = (input.asr.workerStatus ?? "").toLowerCase() === "ready";
    if (!(sourceFresh && sourceReady && workerReady)) {
      items.push({
        id: "asr-health",
        severity: "warning",
        affectedCapability: "asr",
        impact: `Speech recognition from ${input.asr.name} is degraded, so automatic transcript and Scripture detection may be delayed.`,
        containment: "Manual Scripture and Media operation remains available, and Program is not changed by this ASR state.",
        recommendedAction: "Open AI Director to inspect speech-recognition health or continue manually.",
        detailHref: "/ai-director",
        observedAt: input.asr.lastSeenAt,
        freshUntil: isoPlus(input.asr.lastSeenAt),
        recoveryIntent: "navigation.open:/ai-director"
      });
    }
  }

  if (input.translation.languages.length && !workerHealthy(input.translation.worker, now)) {
    const languages = languageLabel(input.translation.languages);
    items.push({
      id: "translation-health",
      severity: "warning",
      affectedCapability: "translations.text",
      impact: `Translated captions for ${languages} are currently unavailable or delayed.`,
      containment: "Original-language audio and the current Program remain available.",
      recommendedAction: "Open Translations to inspect the text-translation worker and affected channels.",
      detailHref: "/translations",
      observedAt: input.translation.worker?.observedAt ?? null,
      freshUntil: isoPlus(input.translation.worker?.observedAt),
      recoveryIntent: "status.explain:translations"
    });
  }

  if (input.tts.languages.length && !workerHealthy(input.tts.worker, now)) {
    const languages = languageLabel(input.tts.languages);
    items.push({
      id: "tts-health",
      severity: "warning",
      affectedCapability: "translations.audio",
      impact: `Translated voice audio for ${languages} is currently unavailable or delayed.`,
      containment: "Original-language audio and the current Program remain available.",
      recommendedAction: "Open Translations to inspect voice-translation health and affected channels.",
      detailHref: "/translations",
      observedAt: input.tts.worker?.observedAt ?? null,
      freshUntil: isoPlus(input.tts.worker?.observedAt),
      recoveryIntent: "status.explain:translations"
    });
  }

  for (const destination of input.streamDestinations) {
    const observedFresh = fresh(destination.observedAt, now);
    const unhealthy = ["warning", "error"].includes(destination.status)
      || ["warning", "error"].includes(destination.providerHealthState)
      || ["not_live", "error"].includes(destination.providerLiveState)
      || (!observedFresh && ["live", "connecting"].includes(destination.status));
    if (!unhealthy) continue;
    const capability = `streaming.${safeCapability(destination.destinationType)}`;
    const staleSuffix = observedFresh ? "" : " Provider health is stale.";
    items.push({
      id: `stream-${safeCapability(destination.name)}`,
      severity: "warning",
      affectedCapability: capability,
      impact: `${destination.name} stream is interrupted or not confirmed live.${staleSuffix}`,
      containment: "Local Program and other unrelated destinations remain unaffected by this destination state.",
      recommendedAction: `Open Streaming and verify ${destination.name}; retry only when the provider is ready.`,
      detailHref: "/streaming",
      observedAt: destination.observedAt,
      freshUntil: isoPlus(destination.observedAt),
      recoveryIntent: "status.explain:streaming"
    });
  }

  if (input.subscription) {
    const expiresAt = dateMs(input.subscription.expiresAt);
    const graceUntil = dateMs(input.subscription.graceUntil);
    const inGrace = graceUntil !== null && graceUntil >= now.getTime()
      && (input.subscription.status === "past_due" || (expiresAt !== null && expiresAt < now.getTime()));
    const blocked = ["suspended", "expired", "cancelled"].includes(input.subscription.status)
      || (expiresAt !== null && expiresAt < now.getTime() && !inGrace);
    if (inGrace) {
      items.push({
        id: "subscription-grace",
        severity: "warning",
        affectedCapability: "subscription",
        impact: `Subscription renewal needs attention. Premium capabilities are operating in grace until ${new Date(graceUntil!).toISOString()}.`,
        containment: "Stop, read, history and Settings remain available while renewal is resolved.",
        recommendedAction: "Open Subscription settings and renew before the grace window ends.",
        detailHref: "/settings/subscription",
        observedAt: input.subscription.expiresAt,
        freshUntil: input.subscription.graceUntil,
        recoveryIntent: "navigation.open:/settings/subscription"
      });
    } else if (blocked) {
      items.push({
        id: "subscription-blocked",
        severity: "critical",
        affectedCapability: "subscription",
        impact: "The subscription is outside its active/grace window, so new premium operations are blocked.",
        containment: "Stop, read, history and Settings remain available; church content is not deleted.",
        recommendedAction: "Open Subscription settings to renew or restore the plan.",
        detailHref: "/settings/subscription",
        observedAt: input.subscription.expiresAt,
        freshUntil: input.subscription.graceUntil,
        recoveryIntent: "navigation.open:/settings/subscription"
      });
    }
  }

  return items.sort((left, right) => {
    const rank = (item: CockpitAttentionItem) => item.severity === "critical" ? 0 : item.severity === "warning" ? 1 : 2;
    const severity = rank(left) - rank(right);
    if (severity) return severity;
    return left.id.localeCompare(right.id);
  });
}

type WorkerRow = { provider:string; state:string; error_code:string|null; observed_at:string|null };
type EdgeRow = { name:string; status:string; last_seen_at:string|null };
type AsrRow = { name:string; status:string; last_seen_at:string|null; metadata:Record<string,unknown>|null };
type StreamRow = { name:string; destination_type:string; status:string; provider_health_state:string; provider_live_state:string; observed_at:string|null; provider_error_code:string|null; provider_issue_codes:string[]|null };
type SubscriptionRow = { status:string; expires_at:string|null; grace_until:string|null };

export async function loadCockpitAttention(
  client: PoolClient,
  input: { organizationId:string; serviceId:string; serviceLive:boolean; now?:Date }
): Promise<CockpitAttentionItem[]> {
  const now = input.now ? new Date(input.now) : new Date();
  const edge = await client.query<EdgeRow>(
    `select name,status,last_seen_at::text from edge_devices
      where organization_id=$1 and (active_service_id=$2 or active_service_id is null)
      order by case when active_service_id=$2 then 0 else 1 end,last_seen_at desc nulls last,id limit 1`,
    [input.organizationId,input.serviceId]
  );
  const asr = await client.query<AsrRow>(
    `select name,status,last_seen_at::text,metadata from media_sources
      where organization_id=$1 and source_type='audio_input'
      order by last_seen_at desc nulls last,id limit 1`,
    [input.organizationId]
  );
  const translation = await client.query<WorkerRow>(
    `select provider,state,error_code,observed_at::text from translation_worker_status order by observed_at desc,worker_id limit 1`
  );
  const tts = await client.query<WorkerRow>(
    `select provider,state,error_code,observed_at::text from tts_worker_status order by observed_at desc,worker_id limit 1`
  );
  const channels = await client.query<{language_name:string;channel_mode:string}>(
    `select language_name,channel_mode from language_channels
      where organization_id=$1 and enabled=true and channel_mode in ('translation_text','translation_audio')
      order by channel_mode,language_name,language_code`,
    [input.organizationId]
  );
  const streams = await client.query<StreamRow>(
    `with latest as (
       select id from stream_sessions where service_id=$1 and status in ('starting','live','stopping','error')
       order by created_at desc,id desc limit 1
     )
     select od.name,od.destination_type,ssd.status,ssd.provider_health_state,ssd.provider_live_state,
            coalesce(ssd.provider_checked_at,ssd.last_heartbeat_at,ssd.updated_at)::text as observed_at,
            ssd.provider_error_code,ssd.provider_issue_codes
       from latest l
       join stream_session_destinations ssd on ssd.stream_session_id=l.id
       join output_destinations od on od.id=ssd.output_destination_id
      where od.organization_id=$2 and od.enabled=true
      order by od.name,od.id`,
    [input.serviceId,input.organizationId]
  );
  const subscription = await client.query<SubscriptionRow>(
    `select status,expires_at::text,grace_until::text from organization_subscriptions
      where organization_id=$1
      order by case when status in ('trial','active','past_due','suspended') then 0 else 1 end,created_at desc,id desc limit 1`,
    [input.organizationId]
  );

  const audio = asr.rows[0];
  const metadata = audio?.metadata ?? {};
  return buildCockpitAttention({
    now,
    serviceLive: input.serviceLive,
    edge: edge.rows[0] ? { name:edge.rows[0].name,status:edge.rows[0].status,lastSeenAt:edge.rows[0].last_seen_at } : null,
    asr: audio ? {
      name:audio.name,status:audio.status,lastSeenAt:audio.last_seen_at,
      workerStatus:typeof metadata.asrWorkerStatus === "string" ? metadata.asrWorkerStatus : null,
      engine:typeof metadata.asrWorkerEngine === "string" ? metadata.asrWorkerEngine : null
    } : null,
    translation: {
      languages:channels.rows.filter((row)=>row.channel_mode==="translation_text").map((row)=>row.language_name),
      worker:translation.rows[0] ? {provider:translation.rows[0].provider,state:translation.rows[0].state,errorCode:translation.rows[0].error_code,observedAt:translation.rows[0].observed_at}:null
    },
    tts: {
      languages:channels.rows.filter((row)=>row.channel_mode==="translation_audio").map((row)=>row.language_name),
      worker:tts.rows[0] ? {provider:tts.rows[0].provider,state:tts.rows[0].state,errorCode:tts.rows[0].error_code,observedAt:tts.rows[0].observed_at}:null
    },
    streamDestinations:streams.rows.map((row)=>({name:row.name,destinationType:row.destination_type,status:row.status,providerHealthState:row.provider_health_state,providerLiveState:row.provider_live_state,observedAt:row.observed_at,errorCode:row.provider_error_code,issueCodes:row.provider_issue_codes ?? []})),
    subscription:subscription.rows[0] ? {status:subscription.rows[0].status,expiresAt:subscription.rows[0].expires_at,graceUntil:subscription.rows[0].grace_until}:null
  });
}
