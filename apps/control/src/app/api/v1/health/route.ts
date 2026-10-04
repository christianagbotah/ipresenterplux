import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query<{ now: string; database: string }>(
      "select now()::text as now, current_database() as database"
    );
    return NextResponse.json({
      ok: true,
      product: "iPresenterPlux",
      version: "0.1.0",
      database: { status: "healthy", name: result.rows[0].database },
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
  } catch (error) {
    return NextResponse.json(
      { ok: false, product: "iPresenterPlux", error: error instanceof Error ? error.message : "Health check failed" },
      { status: 503 }
    );
  }
}
