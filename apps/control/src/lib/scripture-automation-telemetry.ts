import type { PoolClient } from "pg";
import { isFatalScriptureAutomationReason, type ScriptureAutomationMode } from "./scripture-automation.ts";

const AUTO_LIVE_LATENCY_TARGET_MS = 1_500;

export async function applyScriptureAutomationCircuitBreaker(
  client: PoolClient,
  input: {
    organizationId: string;
    serviceId: string;
    actorUserId: string;
    mode: ScriptureAutomationMode;
    armed: boolean;
    reason: string;
  }
) {
  if (input.mode !== "auto_live" || !input.armed || !isFatalScriptureAutomationReason(input.reason)) return false;

  const updated = await client.query<{ id: string }>(
    `update services
        set scripture_automation_armed_at=null,
            scripture_automation_armed_by=null,
            scripture_automation_suspended_reason=$2,
            updated_at=clock_timestamp()
      where id=$1::uuid
        and scripture_automation_mode='auto_live'
        and (scripture_automation_armed_at is not null or scripture_automation_armed_by is not null)
      returning id::text`,
    [input.serviceId, input.reason]
  );
  if (!updated.rows[0]) return false;

  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'automation',$2,'scripture.automation.suspended','service',$3,$4::jsonb)`,
    [input.organizationId, input.actorUserId, input.serviceId, JSON.stringify({ reason: input.reason })]
  );
  return true;
}

export async function recordAutoScriptureLiveTake(
  client: PoolClient,
  input: {
    organizationId: string;
    serviceId: string;
    actorUserId: string;
    detectionId: string;
    reference: string;
    detectionMethod: string;
    confidence: number;
    observedAt: Date;
    decisionReason: string;
    edgeCommandsQueued: number;
    finalizedRecognitionAt: Date;
    programCommandQueuedAt: Date;
  }
) {
  const latencyMs = Math.max(0, input.programCommandQueuedAt.getTime() - input.finalizedRecognitionAt.getTime());
  const withinTarget = latencyMs <= AUTO_LIVE_LATENCY_TARGET_MS;
  const details = {
    detectionId: input.detectionId,
    reference: input.reference,
    detectionMethod: input.detectionMethod,
    confidence: input.confidence,
    observedAt: input.observedAt.toISOString(),
    decisionReason: input.decisionReason,
    edgeCommandsQueued: input.edgeCommandsQueued,
    finalizedRecognitionAt: input.finalizedRecognitionAt.toISOString(),
    programCommandQueuedAt: input.programCommandQueuedAt.toISOString(),
    latencyMs,
    latencyTargetMs: AUTO_LIVE_LATENCY_TARGET_MS,
    withinTarget
  };

  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'automation',$2,'scripture.automation.auto_take','scripture_detection',$3,$4::jsonb)`,
    [input.organizationId, input.actorUserId, input.detectionId, JSON.stringify(details)]
  );

  return { latencyMs, withinTarget };
}
