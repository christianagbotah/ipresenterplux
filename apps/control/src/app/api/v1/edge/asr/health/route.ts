import { NextResponse } from "next/server";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { forwardEdgeAsrHealth } from "@/lib/edge-asr-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  return forwardEdgeAsrHealth();
}
