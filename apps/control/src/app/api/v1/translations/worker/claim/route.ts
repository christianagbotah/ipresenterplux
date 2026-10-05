import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateTranslationWorker } from "@/lib/translation-worker-auth";
import { claimTranslationJobs } from "@/lib/translation-worker";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workerId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  limit: z.number().int().min(1).max(20).optional(),
  leaseSeconds: z.number().int().min(15).max(300).optional()
});

export async function POST(request: Request) {
  if (!authenticateTranslationWorker(request)) {
    return NextResponse.json({ ok: false, error: "Translation worker authentication required" }, { status: 401 });
  }

  try {
    const { workerId, limit = 4, leaseSeconds = 45 } = bodySchema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");
      const jobs = await claimTranslationJobs(client, workerId, limit, leaseSeconds);
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
      return NextResponse.json({ ok: false, error: "Invalid worker claim request", issues: error.issues }, { status: 400 });
    }
    console.error("Translation worker claim failed", error);
    return NextResponse.json({ ok: false, error: "Translation jobs could not be claimed" }, { status: 500 });
  }
}
