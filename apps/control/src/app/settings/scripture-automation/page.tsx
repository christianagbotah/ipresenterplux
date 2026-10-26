import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { ScriptureAutomationControl } from "@/components/scripture/ScriptureAutomationControl";

export const dynamic = "force-dynamic";

type OrganizationRow = {
  id: string;
  name: string;
  roles: string[];
  auto_scripture_live_enabled: boolean;
};

export default async function ScriptureAutomationSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const membership = await query<OrganizationRow>(
    `select o.id::text,o.name,o.auto_scripture_live_enabled,
            array_agg(uor.role_id order by uor.role_id)::text[] as roles
       from user_organization_roles uor
       join organizations o on o.id=uor.organization_id
      where uor.user_id=$1
      group by o.id,o.name,o.auto_scripture_live_enabled
      having bool_or(uor.role_id in ('owner','admin'))
      order by o.name,o.id
      limit 1`,
    [session.user.id]
  );
  const organization = membership.rows[0];
  if (!organization) redirect("/settings");

  const canManage = organization.roles.some((role) => role === "owner" || role === "admin");

  return <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-7 flex items-center gap-4">
        <Link href="/settings" className="ip-focus-gold flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/70" aria-label="Back to Settings"><ArrowLeft size={17}/></Link>
        <div><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><ShieldCheck size={13}/> Scripture automation</div><h1 className="mt-1 text-2xl font-black">Auto Scripture Live permission</h1><p className="mt-1 text-sm text-white/55">{organization.name}</p></div>
      </header>

      <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-400/[.06] p-4 text-sm leading-6 text-amber-100">
        Organization permission does not put Scripture on air. An authorized operator must choose Auto Scripture Live and arm it separately for a live service with an active Edge.
      </div>

      <ScriptureAutomationControl key={`${organization.id}:${organization.auto_scripture_live_enabled ? "on" : "off"}`} scope="organization" organizationId={organization.id} enabled={organization.auto_scripture_live_enabled} canManage={canManage}/>
    </div>
  </main>;
}
