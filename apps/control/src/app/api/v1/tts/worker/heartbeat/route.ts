import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authenticateTtsWorker } from "@/lib/tts-worker-auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workerId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  provider: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  state: z.enum(["disabled", "ready", "degraded", "stopping"]),
  softwareVersion: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._+-]+$/).optional(),
  claimed: z.number().int().min(0).max(10_000),
  completed: z.number().int().min(0).max(10_000),
  failed: z.number().int().min(0).max(10_000),
  errorCode: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/).nullable().optional()
});

export async function POST(request: Request) {
  if (!authenticateTtsWorker(request)) {
    return NextResponse.json({ ok: false, error: "TTS worker authentication required" }, { status: 401 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    await query(
      `insert into tts_worker_status
        (worker_id,provider,state,software_version,claimed_count,completed_count,failed_count,error_code,observed_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),clock_timestamp())
       on conflict (worker_id) do update set
         provider=excluded.provider,
         state=excluded.state,
         software_version=excluded.software_version,
         claimed_count=excluded.claimed_count,
         completed_count=excluded.completed_count,
         failed_count=excluded.failed_count,
         error_code=excluded.error_code,
         observed_at=clock_timestamp(),
         updated_at=clock_timestamp()`,
      [
        body.workerId,
        body.provider,
        body.state,
        body.softwareVersion ?? null,
        body.claimed,
        body.completed,
        body.failed,
        body.errorCode ?? null
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid TTS worker heartbeat", issues: error.issues }, { status: 400 });
    }
    console.error("TTS worker heartbeat failed", error);
    return NextResponse.json({ ok: false, error: "TTS worker heartbeat could not be saved" }, { status: 500 });
  }
}
