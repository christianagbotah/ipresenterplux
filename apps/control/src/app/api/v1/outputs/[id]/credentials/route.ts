import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { encryptDestinationSecret } from "@/lib/destination-secrets";
import { isSocialDestinationType, normalizeRtmpsIngestUrl } from "@/lib/destination-routing";
import { STREAM_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  ingestUrl: z.string().trim().min(1).max(2048),
  streamKey: z.string().trim().min(1).max(4096)
});

async function authorizeOutput(userId: string, outputId: string) {
  const target = await db.query<{
    id: string;
    organization_id: string;
    name: string;
    destination_type: string;
    public_config: Record<string, unknown>;
  }>(
    `select id::text,organization_id::text,name,destination_type,public_config
     from output_destinations where id=$1::uuid`,
    [outputId]
  );
  const row = target.rows[0];
  if (!row) return { error: NextResponse.json({ ok: false, error: "Output destination not found" }, { status: 404 }) } as const;
  if (!isSocialDestinationType(row.destination_type)) {
    return { error: NextResponse.json({ ok: false, error: "This destination does not use RTMPS credentials" }, { status: 409 }) } as const;
  }
  if (!(await userHasAnyRole(userId, row.organization_id, STREAM_OPERATOR_ROLES))) {
    return { error: NextResponse.json({ ok: false, error: "You are not allowed to manage broadcast outputs" }, { status: 403 }) } as const;
  }
  return { row } as const;
}

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 }) } as const;
  if (session.user.forcePasswordChange) return { error: NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 }) } as const;
  return { session } as const;
}

async function organizationBroadcastActive(client: Awaited<ReturnType<typeof db.connect>>, organizationId: string) {
  const active = await client.query<{ active: boolean }>(
    `select exists(
       select 1
       from stream_sessions ss
       join services s on s.id=ss.service_id
       where s.organization_id=$1::uuid
         and ss.status in ('starting','live','stopping')
     ) as active`,
    [organizationId]
  );
  return Boolean(active.rows[0]?.active);
}

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid output id" }, { status: 400 });

  const access = await authorizeOutput(authResult.session.user.id, id);
  if ("error" in access) return access.error;
  const credential = await db.query<{ configured: boolean; configured_at: string | null; updated_at: string | null }>(
    `select true as configured,configured_at::text,updated_at::text
     from output_destination_credentials where output_destination_id=$1::uuid`,
    [id]
  );
  const row = credential.rows[0];
  return NextResponse.json({
    ok: true,
    credential: {
      configured: Boolean(row?.configured),
      ingestUrl: typeof access.row.public_config?.ingestUrl === "string" ? access.row.public_config.ingestUrl : null,
      configuredAt: row?.configured_at ?? null,
      updatedAt: row?.updated_at ?? null
    }
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid output id" }, { status: 400 });

  try {
    const input = updateSchema.parse(await request.json());
    const ingestUrl = normalizeRtmpsIngestUrl(input.ingestUrl);
    const secretCiphertext = encryptDestinationSecret({ streamKey: input.streamKey });
    const client = await db.connect();
    try {
      await client.query("begin");
      const target = await client.query<{
        id: string; organization_id: string; name: string; destination_type: string; public_config: Record<string, unknown>;
      }>(
        `select id::text,organization_id::text,name,destination_type,public_config
         from output_destinations where id=$1::uuid for update`,
        [id]
      );
      const row = target.rows[0];
      if (!row) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Output destination not found" }, { status: 404 });
      }
      if (!isSocialDestinationType(row.destination_type)) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "This destination does not use RTMPS credentials" }, { status: 409 });
      }
      if (!(await userHasAnyRole(authResult.session.user.id, row.organization_id, STREAM_OPERATOR_ROLES))) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to manage broadcast outputs" }, { status: 403 });
      }
      if (await organizationBroadcastActive(client, row.organization_id)) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Destination credentials are locked during an active broadcast" }, { status: 409 });
      }

      await client.query(
        `insert into output_destination_credentials(output_destination_id,secret_ciphertext,key_version,configured_at,updated_at)
         values ($1::uuid,$2,1,now(),now())
         on conflict (output_destination_id) do update
         set secret_ciphertext=excluded.secret_ciphertext,key_version=excluded.key_version,updated_at=now()`,
        [id, secretCiphertext]
      );
      await client.query(
        `update output_destinations
         set public_config=coalesce(public_config,'{}'::jsonb) || jsonb_build_object(
               'protocol','RTMPS','ingestUrl',$2::text,'credentialConfigured',true
             ),
             status=case when enabled then 'ready' else 'disconnected' end,
             updated_at=now()
         where id=$1::uuid`,
        [id, ingestUrl]
      );
      await client.query(
        `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1::uuid,'operator',$2,'output.credentials.configured','output_destination',$3,$4::jsonb)`,
        [row.organization_id, authResult.session.user.id, id, JSON.stringify({ name: row.name, destinationType: row.destination_type, ingestUrl })]
      );
      await client.query("commit");
      return NextResponse.json({ ok: true, credential: { configured: true, ingestUrl } }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid destination credentials", issues: error.issues }, { status: 400 });
    const code = error instanceof Error ? error.message : "unknown";
    if (code.startsWith("destination_")) return NextResponse.json({ ok: false, error: "Destination credential configuration is invalid", code }, { status: 400 });
    console.error("Destination credential update failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false, error: "Destination credential update failed" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid output id" }, { status: 400 });

  const client = await db.connect();
  try {
    await client.query("begin");
    const target = await client.query<{ organization_id: string; name: string; destination_type: string }>(
      `select organization_id::text,name,destination_type from output_destinations where id=$1::uuid for update`,
      [id]
    );
    const row = target.rows[0];
    if (!row) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Output destination not found" }, { status: 404 });
    }
    if (!isSocialDestinationType(row.destination_type)) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "This destination does not use RTMPS credentials" }, { status: 409 });
    }
    if (!(await userHasAnyRole(authResult.session.user.id, row.organization_id, STREAM_OPERATOR_ROLES))) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "You are not allowed to manage broadcast outputs" }, { status: 403 });
    }
    if (await organizationBroadcastActive(client, row.organization_id)) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Destination credentials are locked during an active broadcast" }, { status: 409 });
    }

    await client.query("delete from output_destination_credentials where output_destination_id=$1::uuid", [id]);
    await client.query(
      `update output_destinations
       set enabled=false,status='disconnected',
           public_config=(coalesce(public_config,'{}'::jsonb) - 'ingestUrl') || jsonb_build_object('credentialConfigured',false),
           updated_at=now()
       where id=$1::uuid`,
      [id]
    );
    await client.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1::uuid,'operator',$2,'output.credentials.cleared','output_destination',$3,$4::jsonb)`,
      [row.organization_id, authResult.session.user.id, id, JSON.stringify({ name: row.name, destinationType: row.destination_type })]
    );
    await client.query("commit");
    return NextResponse.json({ ok: true, credential: { configured: false, ingestUrl: null } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback");
    console.error("Destination credential delete failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false, error: "Destination credential delete failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
