import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AudioLines, ChevronRight, CreditCard, MonitorCog, Settings2, ShieldCheck } from "lucide-react";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { DEVICE_ADMIN_ROLES, VOICE_ADMIN_ROLES } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  name: string;
  roles: string[];
};

export default async function SettingsPage() {
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
  const roles = organization?.roles ?? [];
  const canDevices = roles.some((role) => DEVICE_ADMIN_ROLES.includes(role as never));
  const canVoices = roles.some((role) => VOICE_ADMIN_ROLES.includes(role as never));
  const canSubscription = canDevices;

  const cards = [
    canDevices ? {
      href: "/settings/devices",
      title: "Edge Devices",
      description: "Pair Windows and macOS church computers, rotate credentials and monitor connection health.",
      icon: MonitorCog
    } : null,
    canSubscription ? {
      href: "/settings/subscription",
      title: "Subscription & Activation",
      description: "View your plan, expiry, grace period, seat usage and deactivate retired desktop installations.",
      icon: CreditCard
    } : null,
    canVoices ? {
      href: "/settings/voices",
      title: "Voice Consent",
      description: "Govern explicit speaker consent before any personalized synthetic voice can be enrolled or used.",
      icon: AudioLines
    } : null
  ].filter(Boolean) as Array<{ href: string; title: string; description: string; icon: typeof MonitorCog }>;

  return (
    <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex items-center gap-4">
          <Link href="/" className="ip-focus-gold flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/70 transition hover:bg-white/[.06] hover:text-white" aria-label="Back to Control Room">
            <ArrowLeft size={17} />
          </Link>
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><Settings2 size={13} /> Settings</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Platform settings</h1>
            <p className="mt-1 text-sm text-white/55">{organization?.name ?? "No organization assigned"}</p>
          </div>
        </header>

        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-4 text-xs leading-5 text-white/55">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-300" />
          Sensitive controls are role-gated, audited and kept separate from ordinary presentation operation.
        </div>

        {cards.length ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ href, title, description, icon: Icon }) => (
              <Link key={href} href={href} className="ip-focus-gold ip-ai-arrive group cursor-pointer rounded-[22px] border border-white/[.08] bg-[#0d121a] p-5 transition hover:border-[#d7a94a]/25 hover:bg-[#111721]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#d7a94a]/15 bg-[#d7a94a]/[.07] text-[#efc76e]"><Icon size={19} /></div>
                  <ChevronRight size={16} className="mt-3 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-[#d7a94a]" />
                </div>
                <h2 className="mt-5 text-base font-black">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/55">{description}</p>
              </Link>
            ))}
          </section>
        ) : (
          <div className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-8 text-center text-sm text-white/55">
            Your current role has no organization-wide settings to manage.
          </div>
        )}
      </div>
    </main>
  );
}
