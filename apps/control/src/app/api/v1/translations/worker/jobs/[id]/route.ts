import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { publishServiceEvent } from "@/lib/realtime";
import { enqueueSpeechSynthesisJob } from "@/lib/speech-synthesis-jobs";
import { authenticateTranslationWorker } from "@/lib/translation-worker-auth";
import { completeTranslationJob, failTranslationJob } from "@/lib/translation-worker";

export const dynamic = "force-dynamic";

const successSchema = z.object({
  outcome: z.literal("succeeded"),
  leaseToken: z.string().uuid(),
  translatedText: z.string().trim().min(1).max(20_000),
  provider: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/)
});

const failureSchema = z.object({
  outcome: z.literal("failed"),
  leaseToken: z.string().uuid(),
  errorCode: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/)
});

const bodySchema = z.discriminatedUnion("outcome", [successSchema, failureSchema]);
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!authenticateTranslationWorker(request)) {
    return NextResponse.json({ ok: false, error: "Translation worker authentication required" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid translation job id" }, { status: 400 });
  }

  try {
    const payload = bodySchema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");

      if (payload.outcome === "succeeded") {
        const result = await completeTranslationJob(
          client,
          id,
          payload.leaseToken,
          payload.translatedText,
          payload.provider
        );
        if (!result) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Translation job lease is no longer active" }, { status: 409 });
        }

        const synthesisJob = await enqueueSpeechSynthesisJob(client, id);

        await client.query(
          `insert into audit_events
            (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
           values ($1,'system',$2,'translation.worker.completed','transcript_translation_job',$3,$4::jsonb)`,
          [
            result.organization_id,
            result.worker_id ?? "translation-worker",
            id,
            JSON.stringify({
              targetLanguageCode: result.target_language_code,
              channelMode: result.channel_mode,
              provider: payload.provider,
              speechSynthesisQueued: Boolean(synthesisJob)
            })
          ]
        );
        await client.query("commit");

        await publishServiceEvent(result.service_id, "translation.completed", {
          id,
          languageChannelId: result.language_channel_id,
          targetLanguageCode: result.target_language_code,
          channelMode: result.channel_mode
        });
        return NextResponse.json({ ok: true, job: result });
      }

      const result = await failTranslationJob(client, id, payload.leaseToken, payload.errorCode);
      if (!result) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Translation job lease is no longer active" }, { status: 409 });
      }

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'system',$2,'translation.worker.failed','transcript_translation_job',$3,$4::jsonb)`,
        [
          result.organization_id,
          result.worker_id ?? "translation-worker",
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

      await publishServiceEvent(result.service_id, "translation.failed", {
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
      return NextResponse.json({ ok: false, error: "Invalid translation worker result", issues: error.issues }, { status: 400 });
    }
    console.error("Translation worker result failed", error);
    return NextResponse.json({ ok: false, error: "Translation worker result could not be saved" }, { status: 500 });
  }
}
