import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { inspectExistingEdgeEvent, registerEdgeEvent } from "@/lib/edge-events";
import {
  findActiveServiceForDevice,
  findServiceById,
  ingestTranscriptForService,
  publishTranscriptIngestResult
} from "@/lib/transcript-ingest";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  eventId: z.string().uuid(),
  serviceId: z.string().uuid().nullish(),
  startedAt: z.string().datetime(),
  text: z.string().min(1).max(10_000),
  bibleVersion: z.string().min(2).max(40).optional()
});

export async function POST(request: Request) {
  try {
    const device = await authenticateEdgeDevice(request);
    if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

    const payload = inputSchema.parse(await request.json());
    const receiptPayload = {
      serviceId: payload.serviceId ?? null,
      startedAt: payload.startedAt,
      text: payload.text,
      bibleVersion: payload.bibleVersion ?? null
    };
    const client = await db.connect();
    try {
      await client.query("begin");
      const existing = await inspectExistingEdgeEvent(client, {
        deviceId: device.deviceId,
        eventId: payload.eventId,
        eventKind: "transcript",
        payload: receiptPayload
      });
      if (existing === "conflict") {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Event ID already exists with different content" }, { status: 409 });
      }
      if (existing === "duplicate") {
        await client.query("commit");
        return NextResponse.json({ ok: true, duplicate: true, eventId: payload.eventId });
      }

      const service = payload.serviceId
        ? await findServiceById(payload.serviceId)
        : await findActiveServiceForDevice(device.organizationId, device.campusId);
      if (!service) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "No active or ready service found" }, { status: 404 });
      }
      if (service.organization_id !== device.organizationId || (device.campusId && service.campus_id !== device.campusId)) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service is outside this Edge device scope" }, { status: 403 });
      }

      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [service.id]);

      const receipt = await registerEdgeEvent(client, {
        deviceId: device.deviceId,
        organizationId: device.organizationId,
        eventId: payload.eventId,
        eventKind: "transcript",
        serviceId: service.id,
        occurredAt: payload.startedAt,
        payload: receiptPayload
      });
      if (receipt.state !== "new") {
        await client.query("rollback");
        return NextResponse.json(
          receipt.state === "duplicate"
            ? { ok: true, duplicate: true, eventId: payload.eventId }
            : { ok: false, error: "Event ID already exists with different content" },
          { status: receipt.state === "duplicate" ? 200 : 409 }
        );
      }

      const result = await ingestTranscriptForService(service, payload, client);
      await client.query("commit");
      await publishTranscriptIngestResult(result);
      return NextResponse.json({ ...result, eventId: payload.eventId, duplicate: false });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid transcript payload", issues: error.issues }, { status: 400 });
    console.error("Edge transcript ingestion failed", error);
    return NextResponse.json({ ok: false, error: "Transcript processing failed" }, { status: 500 });
  }
}
