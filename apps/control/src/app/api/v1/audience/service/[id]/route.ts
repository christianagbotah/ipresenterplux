import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadPublicAudienceService } from "@/lib/public-audience-service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid service" }, { status: 400, headers: noStore });
  }

  const payload = await loadPublicAudienceService(db, id);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Service unavailable" }, { status: 404, headers: noStore });
  }

  return NextResponse.json({ ok: true, ...payload }, { headers: noStore });
}
