import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateTtsWorker } from "@/lib/tts-worker-auth";
import { claimTtsJobs } from "@/lib/tts-worker";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workerId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  leaseSeconds: z.number().int().min(15).max(120).optional()
});

export async function POST(request: Request) {
  if (!authenticateTtsWorker(request)) {
    return NextResponse.json({ ok: false, error: "TTS worker authentication required" }, { status: 401 });
  }
  try {
    const { workerId, leaseSeconds = 45 } = bodySchema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");
      const jobs = await claimTtsJobs(client, workerId, 1, leaseSeconds);
      await client.query("commit");
      return NextResponse.json({ ok: true, jobs });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid TTS worker claim request", issues: error.issues }, { status: 400 });
    }
    console.error("TTS worker claim failed", error);
    return NextResponse.json({ ok: false, error: "TTS jobs could not be claimed" }, { status: 500 });
  }
}
