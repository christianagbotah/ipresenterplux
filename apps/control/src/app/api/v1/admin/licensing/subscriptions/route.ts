import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { requireProductAdminEmail } from "@/lib/licensing/product-admin";
import {
  configureSubscriptionPlan,
  createSubscriptionPlan,
  createOrganizationSubscription,
  extendSubscription,
  getOrganizationSubscriptionOverview,
  listLicensingAudit,
  setSubscriptionSeatLimit,
  setSubscriptionStatus,
  LicensingAdminError
} from "@/lib/licensing/licensing-admin-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_plan"), code: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/u), name: z.string().trim().min(1).max(120), billingInterval: z.enum(["none","month","year","custom"]).default("month"), billingIntervalCount: z.number().int().min(1).max(120).default(1), defaultDeviceSeatLimit: z.number().int().min(1).max(1000).default(1), features: z.record(z.string(),z.boolean()).default({}), numericLimits: z.record(z.string(),z.number()).default({}) }),
  z.object({ action: z.literal("create"), organizationId: z.string().uuid(), planId: z.string().uuid(), status: z.enum(["trial","active","past_due","suspended","expired","cancelled"]).default("active"), deviceSeatLimit: z.number().int().min(1).max(1000).nullable().optional(), expiresAt: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal("set_status"), subscriptionId: z.string().uuid(), status: z.enum(["trial","active","past_due","suspended","expired","cancelled"]), reason: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("extend"), subscriptionId: z.string().uuid(), days: z.number().int().min(1).max(3650), reason: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("set_seats"), subscriptionId: z.string().uuid(), seatLimit: z.number().int().min(1).max(1000).nullable() }),
  z.object({ action: z.literal("configure_plan"), planId: z.string().uuid(), name: z.string().trim().min(1).max(120).optional(), enabled: z.boolean().optional(), defaultDeviceSeatLimit: z.number().int().min(1).max(1000).optional(), features: z.record(z.string(), z.boolean()).optional(), numericLimits: z.record(z.string(), z.number()).optional() })
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
  try {
    const [overview, audit] = await Promise.all([
      getOrganizationSubscriptionOverview(db, organizationId),
      listLicensingAudit(db, organizationId, 50)
    ]);
    return NextResponse.json({ ok: true, overview: { ...overview, audit } }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof LicensingAdminError && error.code === "not_found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load licensing status" }, { status, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const session = await authorize();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid subscription administration request", issues: parsed.error.issues }, { status: 400, headers: NO_STORE });

  const client = await db.connect();
  try {
    await client.query("begin");
    let result;
    switch (parsed.data.action) {
      case "create_plan":
        result = await createSubscriptionPlan(client, { ...parsed.data, actorUserId: session.user.id });
        break;
      case "create":
        result = await createOrganizationSubscription(client, { ...parsed.data, actorUserId: session.user.id });
        break;
      case "set_status":
        result = await setSubscriptionStatus(client, { ...parsed.data, actorUserId: session.user.id });
        break;
      case "extend":
        result = await extendSubscription(client, { ...parsed.data, actorUserId: session.user.id });
        break;
      case "set_seats":
        result = await setSubscriptionSeatLimit(client, { ...parsed.data, actorUserId: session.user.id });
        break;
      case "configure_plan":
        result = await configureSubscriptionPlan(client, { ...parsed.data, actorUserId: session.user.id });
        break;
    }
    await client.query("commit");
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    await client.query("rollback");
    const status = error instanceof LicensingAdminError
      ? error.code === "not_found" ? 404 : error.code === "plan_code_exists" ? 409 : 400
      : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Subscription administration failed" }, { status, headers: NO_STORE });
  } finally {
    client.release();
  }
}
