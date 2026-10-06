import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { encryptProviderTokens, providerSecretKeyConfigured } from "@/lib/provider-secrets";
import { STREAM_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import {
  exchangeYouTubeAuthorizationCode,
  streamingStudioUrl,
  youtubeOAuthConfigured,
  youtubeOAuthScope
} from "@/lib/youtube-oauth";

export const dynamic = "force-dynamic";

function hashState(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function redirect(status: string) {
  try {
    return NextResponse.redirect(streamingStudioUrl(status));
  } catch {
    return NextResponse.json({ ok: false, error: "YouTube account linking is not configured" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return redirect("youtube-auth-required");
  if (session.user.forcePasswordChange) return redirect("youtube-password-change-required");
  if (!youtubeOAuthConfigured() || !providerSecretKeyConfigured()) return redirect("youtube-not-configured");

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) return redirect(providerError === "access_denied" ? "youtube-cancelled" : "youtube-error");
  const state = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";
  if (!state || state.length > 512 || !code || code.length > 4096) return redirect("youtube-invalid-callback");

  const client = await db.connect();
  let output: { id: string; organization_id: string; name: string; destination_type: string } | null = null;
  try {
    await client.query("begin");
    const found = await client.query<{
      output_destination_id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
      organization_id: string;
      name: string;
      destination_type: string;
    }>(
      `select os.output_destination_id::text,os.user_id::text,os.expires_at::text,os.used_at::text,
              od.organization_id::text,od.name,od.destination_type
       from output_destination_oauth_states os
       join output_destinations od on od.id=os.output_destination_id
       where os.state_hash=$1 and os.provider='youtube'
       for update of os`,
      [hashState(state)]
    );
    const row = found.rows[0];
    if (!row || row.user_id !== session.user.id || row.used_at || Date.parse(row.expires_at) <= Date.now() || row.destination_type !== "youtube") {
      await client.query("rollback");
      return redirect("youtube-state-invalid");
    }
    if (!(await userHasAnyRole(session.user.id, row.organization_id, STREAM_OPERATOR_ROLES))) {
      await client.query("rollback");
      return redirect("youtube-forbidden");
    }
    await client.query("update output_destination_oauth_states set used_at=now() where state_hash=$1", [hashState(state)]);
    await client.query("commit");
    output = { id: row.output_destination_id, organization_id: row.organization_id, name: row.name, destination_type: row.destination_type };
  } catch {
    await client.query("rollback");
    return redirect("youtube-state-error");
  } finally {
    client.release();
  }

  if (!output) return redirect("youtube-state-invalid");

  let token;
  try {
    token = await exchangeYouTubeAuthorizationCode(code);
  } catch {
    return redirect("youtube-token-error");
  }
  if (!token.refreshToken) return redirect("youtube-refresh-token-missing");
  if (token.scopes.length && !token.scopes.includes(youtubeOAuthScope)) return redirect("youtube-scope-missing");

  let ciphertext: string;
  try {
    ciphertext = encryptProviderTokens({ accessToken: token.accessToken, refreshToken: token.refreshToken });
  } catch {
    return redirect("youtube-token-storage-error");
  }

  const save = await db.connect();
  try {
    await save.query("begin");
    const active = await save.query<{ active: boolean }>(
      `select exists(
         select 1 from stream_sessions ss join services s on s.id=ss.service_id
         where s.organization_id=$1::uuid and ss.status in ('starting','live','stopping')
       ) as active`,
      [output.organization_id]
    );
    if (active.rows[0]?.active) {
      await save.query("rollback");
      return redirect("youtube-broadcast-active");
    }
    await save.query(
      `insert into output_destination_provider_accounts(
         output_destination_id,provider,token_ciphertext,key_version,scopes,provider_stream_id,
         connected_by,connected_at,token_expires_at,refreshed_at,updated_at
       ) values ($1::uuid,'youtube',$2,1,$3::text[],null,$4::uuid,now(),now()+($5::int*interval '1 second'),now(),now())
       on conflict (output_destination_id) do update
       set provider='youtube',token_ciphertext=excluded.token_ciphertext,key_version=1,scopes=excluded.scopes,
           provider_stream_id=null,connected_by=excluded.connected_by,connected_at=now(),
           token_expires_at=excluded.token_expires_at,refreshed_at=now(),updated_at=now()`,
      [output.id, ciphertext, token.scopes.length ? token.scopes : [youtubeOAuthScope], session.user.id, token.expiresIn]
    );
    await save.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1::uuid,'operator',$2,'output.provider.connected','output_destination',$3,$4::jsonb)`,
      [output.organization_id, session.user.id, output.id, JSON.stringify({ name: output.name, provider: "youtube", scopes: token.scopes.length ? token.scopes : [youtubeOAuthScope] })]
    );
    await save.query("commit");
    return redirect("youtube-connected");
  } catch {
    await save.query("rollback");
    return redirect("youtube-save-error");
  } finally {
    save.release();
  }
}
