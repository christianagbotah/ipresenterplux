import type { PoolClient } from "pg";

export type ScriptureAutomationMode = "manual" | "auto_preview" | "auto_live";

export type ScriptureAutomationDecision = {
  action: "detect" | "preview" | "live";
  reason: string;
};

export function decideScriptureAutomation(input: {
  mode: ScriptureAutomationMode;
  organizationAutoLiveEnabled: boolean;
  serviceStatus: string;
  armed: boolean;
  detectionMethod: string;
  confidence: number;
  referenceThreshold: number;
  quoteThreshold: number;
  stale: boolean;
  competingMatches: number;
  alreadyLiveSameReference: boolean;
  activeEdgeCount: number;
  localBibleReady: boolean;
  asrConfidence: number | null;
}): ScriptureAutomationDecision {
  if (input.mode === "manual") return { action: "detect", reason: "manual_mode" };
  if (!input.localBibleReady) return { action: "detect", reason: "local_bible_unavailable" };
  if (input.stale) return { action: "detect", reason: "stale_detection" };
  if (input.competingMatches > 1) return { action: "detect", reason: "competing_references" };
  if (input.alreadyLiveSameReference) return { action: "detect", reason: "same_reference_already_live" };

  if (input.mode === "auto_preview") return { action: "preview", reason: "auto_preview" };

  if (input.detectionMethod !== "reference" && input.detectionMethod !== "quote") {
    return { action: "preview", reason: "method_not_auto_live" };
  }
  if (!input.organizationAutoLiveEnabled) return { action: "preview", reason: "organization_auto_live_disabled" };
  if (input.serviceStatus !== "live") return { action: "preview", reason: "service_not_live" };
  if (!input.armed) return { action: "preview", reason: "automation_not_armed" };
  if (input.activeEdgeCount < 1) return { action: "preview", reason: "no_active_edge" };
  if (input.asrConfidence !== null && input.asrConfidence < 0.85) {
    return { action: "preview", reason: "low_asr_confidence" };
  }

  if (input.detectionMethod === "reference" && input.confidence < input.referenceThreshold) {
    return { action: "preview", reason: "below_reference_threshold" };
  }
  if (input.detectionMethod === "quote" && input.confidence < input.quoteThreshold) {
    return { action: "preview", reason: "below_quote_threshold" };
  }

  return { action: "live", reason: "eligible_auto_live" };
}

export async function activeAssignedEdgeCount(
  client: PoolClient,
  organizationId: string,
  serviceId: string
) {
  const result = await client.query<{ count: number }>(
    `select count(*)::int as count
       from edge_devices
      where organization_id=$1::uuid
        and active_service_id=$2::uuid
        and status='active'`,
    [organizationId, serviceId]
  );
  return result.rows[0]?.count ?? 0;
}

export async function recentlyLiveReference(
  client: PoolClient,
  serviceId: string,
  reference: string,
  now: Date
) {
  const result = await client.query<{ recent: boolean }>(
    `select (
       exists (
         select 1
           from scripture_detections sd
          where sd.service_id=$1::uuid
            and sd.scripture_reference=$2
            and sd.state='live'
       )
       or exists (
         select 1
           from audit_events ae
           join scripture_detections sd on sd.id::text=ae.entity_id
          where sd.service_id=$1::uuid
            and ae.action='scripture.state.changed'
            and ae.details->>'to'='live'
            and ae.details->>'reference'=$2
            and ae.created_at >= $3::timestamptz - interval '10 seconds'
            and ae.created_at <= $3::timestamptz + interval '1 second'
       )
     ) as recent`,
    [serviceId, reference, now]
  );
  return Boolean(result.rows[0]?.recent);
}
