import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { publishServiceEvent } from "@/lib/realtime";
import { verifyStoredTtsAsset } from "@/lib/tts-audio-storage";
import { authenticateTtsWorker } from "@/lib/tts-worker-auth";
import { completeTtsJob, failTtsJob } from "@/lib/tts-worker";

export const dynamic = "force-dynamic";

const successSchema = z.object({
  outcome: z.literal("succeeded"),
  leaseToken: z.string().uuid(),
  provider: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  audioAssetKey: z.string().trim().min(1).max(220).regex(/^tts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:mp3|wav|ogg)$/i),
  audioContentType: z.enum(["audio/mpeg", "audio/wav", "audio/ogg"]),
  durationMs: z.number().int().min(1).max(600_000)
});

const failureSchema = z.object({
  outcome: z.literal("failed"),
  leaseToken: z.string().uuid(),
  errorCode: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/)
});

const bodySchema = z.discriminatedUnion("outcome", [successSchema, failureSchema]);
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!authenticateTtsWorker(request)) {
    return NextResponse.json({ ok: false, error: "TTS worker authentication required" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid TTS job id" }, { status: 400 });
  }

  try {
    const payload = bodySchema.parse(await request.json());
    if (payload.outcome === "succeeded") {
      const asset = await verifyStoredTtsAsset(payload.audioAssetKey, id, payload.leaseToken, payload.audioContentType);
      if (!asset) {
        return NextResponse.json({ ok: false, error: "TTS audio asset could not be verified" }, { status: 400 });
      }
    }

    const client = await db.connect();
    try {
      await client.query("begin");
      if (payload.outcome === "succeeded") {
        const result = await completeTtsJob(
          client,
          id,
          payload.leaseToken,
          payload.provider,
          payload.audioAssetKey,
          payload.audioContentType,
          payload.durationMs
        );
        if (!result) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "TTS job lease is no longer active" }, { status: 409 });
        }
        await client.query(
          `insert into audit_events
            (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
           values ($1,'system',$2,'tts.worker.completed','speech_synthesis_job',$3,$4::jsonb)`,
          [
            result.organization_id,
            result.worker_id ?? "tts-worker",
            id,
            JSON.stringify({
              targetLanguageCode: result.target_language_code,
              provider: payload.provider,
              audioContentType: payload.audioContentType,
              durationMs: payload.durationMs
            })
          ]
        );
        await client.query("commit");
        await publishServiceEvent(result.service_id, "tts.completed", {
          id,
          languageChannelId: result.language_channel_id,
          targetLanguageCode: result.target_language_code
        });
        return NextResponse.json({ ok: true, job: result });
      }

      const result = await failTtsJob(client, id, payload.leaseToken, payload.errorCode);
      if (!result) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "TTS job lease is no longer active" }, { status: 409 });
      }
      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'system',$2,'tts.worker.failed','speech_synthesis_job',$3,$4::jsonb)`,
        [
          result.organization_id,
          result.worker_id ?? "tts-worker",
          id,
          JSON.stringify({
            attempts: result.attempts,
            status: result.status,
            retryScheduled: result.retry_scheduled,
            errorCode: payload.errorCode
          })
        ]
      );
      await client.query("commit");
      await publishServiceEvent(result.service_id, "tts.failed", {
        id,
        retryScheduled: result.retry_scheduled
      });
      return NextResponse.json({ ok: true, job: result });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid TTS worker result", issues: error.issues }, { status: 400 });
    }
    console.error("TTS worker result failed", error);
    return NextResponse.json({ ok: false, error: "TTS worker result could not be saved" }, { status: 500 });
  }
}
