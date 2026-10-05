import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AudioLines, ShieldCheck } from "lucide-react";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { VOICE_ADMIN_ROLES } from "@/lib/rbac";
import { VoiceConsentManager } from "@/components/voices/VoiceConsentManager";

export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  name: string;
  roles: string[];
};

type VoiceRow = {
  id: string;
  display_name: string;
  source_speaker_id: string | null;
  consent_status: "pending" | "consented" | "revoked";
  consent_method: "written" | "recorded_verbal" | "self_service" | null;
  consent_reference: string | null;
  consented_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  provider: string | null;
  provider_voice_id: string | null;
  created_at: string;
};

export default async function VoiceSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const memberships = await query<MembershipRow>(
    `select o.id::text,o.name,array_agg(uor.role_id order by uor.role_id)::text[] as roles
     from user_organization_roles uor
     join organizations o on o.id=uor.organization_id
     where uor.user_id=$1
     group by o.id,o.name
     order by o.name
     limit 1`,
    [session.user.id]
  );
  const organization = memberships.rows[0];
  const allowed = Boolean(organization?.roles.some((role) => VOICE_ADMIN_ROLES.includes(role as never)));

  if (!organization || !allowed) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-lg rounded-[22px] border border-white/[.08] bg-[#0d121a] p-8 text-center">
          <AudioLines className="mx-auto text-[#d7a94a]" />
          <h1 className="mt-4 text-xl font-black">Voice consent access restricted</h1>
          <p className="mt-2 text-sm leading-6 text-white/40">Only organization owners and administrators can view or change voice consent records.</p>
          <Link href="/settings" className="mt-5 inline-flex rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-2 text-xs font-bold text-white/60">Back to settings</Link>
        </div>
      </main>
    );
  }

  const profiles = await query<VoiceRow>(
    `select id::text,display_name,source_speaker_id,consent_status,consent_method,
            consent_reference,consented_at::text,revoked_at::text,revocation_reason,
            provider,provider_voice_id,created_at::text
     from voice_profiles
     where organization_id=$1
     order by case consent_status when 'consented' then 0 when 'pending' then 1 else 2 end,
              created_at desc,id desc`,
    [organization.id]
  );

  return (
    <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/settings" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/50 transition hover:bg-white/[.06] hover:text-white" aria-label="Back to settings">
              <ArrowLeft size={17} />
            </Link>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]">Settings · Voice governance</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">Voice Consent</h1>
              <p className="mt-1 text-sm text-white/35">Consent and revocation controls for personalized synthetic voices.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/45">
            <ShieldCheck size={14} className="text-emerald-300" />
            Consent does not enroll a voice automatically
          </div>
        </header>

        <VoiceConsentManager
          organizationId={organization.id}
          organizationName={organization.name}
          profiles={profiles.rows.map((profile) => ({
            id: profile.id,
            displayName: profile.display_name,
            sourceSpeakerId: profile.source_speaker_id,
            consentStatus: profile.consent_status,
            consentMethod: profile.consent_method,
            consentReference: profile.consent_reference,
            consentedAt: profile.consented_at,
            revokedAt: profile.revoked_at,
            revocationReason: profile.revocation_reason,
            provider: profile.provider,
            providerVoiceId: profile.provider_voice_id,
            createdAt: profile.created_at
          }))}
        />
      </div>
    </main>
  );
}
