import { NextResponse } from "next/server";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { forwardEdgeAsrRequest } from "@/lib/edge-asr-gateway";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  return forwardEdgeAsrRequest(request);
}
