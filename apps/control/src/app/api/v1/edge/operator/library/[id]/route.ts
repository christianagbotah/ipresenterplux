import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import {
  EdgeOperatorLibraryError,
  resolveEdgeOperatorLibraryItem,
  type EdgeOperatorLibraryQueryClient,
} from "@/lib/edge-operator-library";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid library item id" }, { status: 400 });
  }

  try {
    const item = await resolveEdgeOperatorLibraryItem(
      db as unknown as EdgeOperatorLibraryQueryClient,
      device.organizationId,
      id,
    );
    if (!item) return NextResponse.json({ ok: false, error: "Library item not available for this device" }, { status: 404 });
    return NextResponse.json({ ok: true, item, observedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof EdgeOperatorLibraryError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 422 });
    }
    throw error;
  }
}
