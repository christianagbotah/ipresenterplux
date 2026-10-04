import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import {
  findActiveServiceForDevice,
  findServiceById,
  ingestTranscriptForService
} from "@/lib/transcript-ingest";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  text: z.string().min(1).max(10_000),
  bibleVersion: z.string().min(2).max(40).optional()
});

export async function POST(request: Request) {
  try {
    const device = await authenticateEdgeDevice(request);
    if (!device) {
      return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
    }

    const payload = inputSchema.parse(await request.json());
    const service = payload.serviceId
      ? await findServiceById(payload.serviceId)
      : await findActiveServiceForDevice(device.organizationId, device.campusId);

    if (!service) {
      return NextResponse.json({ ok: false, error: "No active or ready service found" }, { status: 404 });
    }

    if (
      service.organization_id !== device.organizationId ||
      (device.campusId && service.campus_id !== device.campusId)
    ) {
      return NextResponse.json({ ok: false, error: "Service is outside this Edge device scope" }, { status: 403 });
    }

    return NextResponse.json(await ingestTranscriptForService(service, payload));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid transcript payload", issues: error.issues }, { status: 400 });
    }
    console.error("Edge transcript ingestion failed", error);
    return NextResponse.json({ ok: false, error: "Transcript processing failed" }, { status: 500 });
  }
}
