import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { renewProductActivation, ActivationServiceError } from "@/lib/licensing/activation-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const schema = z.object({
  activationId: z.string().uuid(),
  installationId: z.string().trim().min(16).max(200),
  activationToken: z.string().trim().min(32).max(256),
  currentEntitlementId: z.string().uuid()
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
  if (error.code === "invalid_token" || error.code === "not_found") return NextResponse.json({ ok: false, error: "Activation credentials are invalid", code: "invalid_activation" }, { status: 401, headers: NO_STORE });
  if (error.code === "activation_inactive") return NextResponse.json({ ok: false, error: "This installation is deactivated", code: error.code }, { status: 403, headers: NO_STORE });
  if (error.code === "subscription_inactive") return NextResponse.json({ ok: false, error: "Subscription is not active", code: error.code }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ ok: false, error: "Entitlement renewal failed" }, { status: 400, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (httpsRequired(request)) return NextResponse.json({ ok: false, error: "HTTPS is required" }, { status: 400, headers: NO_STORE });
  let payload: z.infer<typeof schema>;
  try {
    payload = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid renewal request", issues: error.issues }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ ok: false, error: "Invalid renewal request" }, { status: 400, headers: NO_STORE });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    try {
      const result = await renewProductActivation(client, payload, { sourceIp: sourceIp(request) });
      await client.query("commit");
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof ActivationServiceError) {
        await client.query("commit");
        return serviceError(error);
      }
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Entitlement renewal failed" }, { status: 500, headers: NO_STORE });
    }
  } finally {
    client.release();
  }
}
