import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { requireProductAdminEmail } from "@/lib/licensing/product-admin";
import {
  issueProductKeyForSubscription,
  listProductKeysForOrganization,
  resetProductKey,
  revokeProductKey,
  LicensingAdminError
} from "@/lib/licensing/licensing-admin-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), subscriptionId: z.string().uuid(), activationLimit: z.number().int().min(1).max(1000).default(1), note: z.string().trim().max(240).optional(), validUntil: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal("reset"), productKeyId: z.string().uuid(), reason: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("revoke"), productKeyId: z.string().uuid(), reason: z.string().trim().max(240).optional() })
]);

async function authorize() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  try {
    requireProductAdminEmail(session.user.email);
    return session;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await authorize();
  if (!session) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success) return NextResponse.json({ ok: false, error: "organizationId is required" }, { status: 400, headers: NO_STORE });
  const keys = await listProductKeysForOrganization(db, organizationId);
  return NextResponse.json({ ok: true, keys }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const session = await authorize();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid licensing key request", issues: parsed.error.issues }, { status: 400, headers: NO_STORE });

  const client = await db.connect();
  try {
    await client.query("begin");
    let result;
    if (parsed.data.action === "issue") {
      result = await issueProductKeyForSubscription(client, {
        subscriptionId: parsed.data.subscriptionId,
        actorUserId: session.user.id,
        activationLimit: parsed.data.activationLimit,
        note: parsed.data.note,
        validUntil: parsed.data.validUntil ?? null
      });
    } else if (parsed.data.action === "reset") {
      result = await resetProductKey(client, { productKeyId: parsed.data.productKeyId, actorUserId: session.user.id, reason: parsed.data.reason });
    } else {
      result = await revokeProductKey(client, { productKeyId: parsed.data.productKeyId, actorUserId: session.user.id, reason: parsed.data.reason });
    }
    await client.query("commit");
    return NextResponse.json({ ok: true, ...result, displayKey: "displayKey" in result ? result.displayKey : undefined }, { headers: NO_STORE });
  } catch (error) {
    await client.query("rollback");
    const status = error instanceof LicensingAdminError && error.code === "not_found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: error instanceof LicensingAdminError ? error.message : "Licensing key request failed" }, { status, headers: NO_STORE });
  } finally {
    client.release();
  }
}
