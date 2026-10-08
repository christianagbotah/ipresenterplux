import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { linkActivationToEdge, ActivationServiceError } from "@/lib/licensing/activation-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const schema = z.object({
  activationId: z.string().uuid(),
  installationId: z.string().trim().min(16).max(200)
});

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401, headers: NO_STORE });

  let payload: z.infer<typeof schema>;
  try {
    payload = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid activation link request", issues: error.issues }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ ok: false, error: "Invalid activation link request" }, { status: 400, headers: NO_STORE });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    try {
      const linked = await linkActivationToEdge(client, {
        activationId: payload.activationId,
        installationId: payload.installationId,
        organizationId: device.organizationId,
        edgeDeviceId: device.deviceId
      });
      await client.query("commit");
      return NextResponse.json({ ok: true, ...linked }, { headers: NO_STORE });
    } catch (error) {
      await client.query("rollback");
      if (error instanceof ActivationServiceError) {
        const status = error.code === "not_found" ? 404 : 403;
        return NextResponse.json({ ok: false, error: "Activation could not be linked to this device", code: error.code }, { status, headers: NO_STORE });
      }
      return NextResponse.json({ ok: false, error: "Activation link failed" }, { status: 500, headers: NO_STORE });
    }
  } finally {
    client.release();
  }
}
