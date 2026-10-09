import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { activateProduct, ActivationServiceError } from "@/lib/licensing/activation-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const schema = z.object({
  productKey: z.string().trim().min(20).max(64),
  installationId: z.string().trim().min(16).max(200),
  platform: z.string().trim().min(2).max(40),
  appVersion: z.string().trim().min(1).max(80),
  deviceName: z.string().trim().min(1).max(120)
});

function sourceIp(request: Request) {
  const candidate = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate : null;
}

function httpsRequired(request: Request) {
  if (process.env.NODE_ENV !== "production") return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwarded || new URL(request.url).protocol.replace(":", "");
  return protocol !== "https";
}

function serviceError(error: ActivationServiceError) {
  if (["invalid_key", "key_inactive"].includes(error.code)) return NextResponse.json({ ok: false, error: "Product key is invalid or unavailable", code: "invalid_key" }, { status: 403, headers: NO_STORE });
  if (error.code === "rate_limited") return NextResponse.json({ ok: false, error: "Activation is temporarily rate limited", code: error.code }, { status: 429, headers: NO_STORE });
  if (error.code === "seat_limit") return NextResponse.json({ ok: false, error: "No activation seat is available", code: error.code }, { status: 409, headers: NO_STORE });
  if (error.code === "subscription_inactive") return NextResponse.json({ ok: false, error: "Subscription is not active", code: error.code }, { status: 403, headers: NO_STORE });
  if (error.code === "activation_inactive") return NextResponse.json({ ok: false, error: "This installation is deactivated", code: error.code }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ ok: false, error: "Activation could not be completed" }, { status: 400, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (httpsRequired(request)) return NextResponse.json({ ok: false, error: "HTTPS is required" }, { status: 400, headers: NO_STORE });
  let payload: z.infer<typeof schema>;
  try {
    payload = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid activation request", issues: error.issues }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ ok: false, error: "Invalid activation request" }, { status: 400, headers: NO_STORE });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    try {
      const result = await activateProduct(client, payload, { sourceIp: sourceIp(request) });
      await client.query("commit");
      return NextResponse.json({ ok: true, ...result }, { status: 201, headers: NO_STORE });
    } catch (error) {
      if (error instanceof ActivationServiceError) {
        await client.query("commit");
        return serviceError(error);
      }
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Activation failed" }, { status: 500, headers: NO_STORE });
    }
  } finally {
    client.release();
  }
}
