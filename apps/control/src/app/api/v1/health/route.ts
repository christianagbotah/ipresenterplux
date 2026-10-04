import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query<{ now: string }>(
      "select now()::text as now"
    );
    return NextResponse.json({
      ok: true,
      product: "iPresenterPlux",
      version: "0.1.0",
      database: { status: "healthy" },
      modules: {
        presentation: "foundation",
        scriptureAi: "foundation",
        streaming: "foundation",
        translation: "foundation",
        audience: "foundation",
        churchManagement: "planned"
      },
      serverTime: result.rows[0].now
    });
  } catch {
    return NextResponse.json(
      { ok: false, product: "iPresenterPlux", database: { status: "degraded" } },
      { status: 503 }
    );
  }
}
