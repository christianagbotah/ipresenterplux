import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarRange, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { auth } from "@auth";
import { CreateServiceDialog } from "@/components/planner/CreateServiceDialog";
import { ServicePlannerList } from "@/components/planner/ServicePlannerList";
import { db, query } from "@/lib/db";
import { roleCapabilities } from "@/lib/role-capabilities";
import { listPlannerServices } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id: string;
  organization_name: string;
  timezone: string;
};

type CampusRow = { id: string; name: string };
type BibleVersionRow = { id: string; name: string; abbreviation: string };

export default async function PlannerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const membership = await query<MembershipRow>(
    `select o.id::text as organization_id,o.name as organization_name,o.timezone
     from organizations o
     where exists (
       select 1 from user_organization_roles uor
       where uor.user_id=$1 and uor.organization_id=o.id
     )
     order by o.created_at,o.id
     limit 1`,
    [session.user.id]
  );
  const organization = membership.rows[0];

  if (!organization) {
    return (
      <main className="min-h-screen bg-[#080b10] px-4 py-12 text-white sm:px-6">
        <div className="mx-auto max-w-2xl rounded-3xl border border-white/[.08] bg-white/[.025] p-8 text-center">
          <CalendarRange size={32} className="mx-auto text-white/20" />
          <h1 className="mt-4 text-xl font-black">No church workspace assigned</h1>
          <p className="mt-2 text-sm leading-6 text-white/40">Your account is signed in but is not currently linked to an organization that can show service plans.</p>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.09] px-4 text-sm font-semibold text-white/65 hover:bg-white/[.04] hover:text-white"><ArrowLeft size={15} />Back to Control Room</Link>
        </div>
      </main>
    );
  }

  const [roles, campuses, bibleVersions] = await Promise.all([
    query<{ role_id: string }>(
      `select role_id from user_organization_roles
       where user_id=$1 and organization_id=$2
       order by role_id`,
      [session.user.id, organization.organization_id]
    ),
    query<CampusRow>(
      `select id::text,name from campuses
       where organization_id=$1
       order by name,id`,
      [organization.organization_id]
    ),
    query<BibleVersionRow>(
      `select id,name,abbreviation from bible_versions
       where local_enabled=true
       order by name,id`
    )
  ]);

  const capabilities = roleCapabilities(roles.rows.map((row) => row.role_id));
  if (!capabilities.canViewPlanner) redirect("/");

  const client = await db.connect();
  let services;
  try {
    services = await listPlannerServices(client, session.user.id, {
      organizationId: organization.organization_id,
      limit: 50,
      offset: 0
    });
  } finally {
    client.release();
  }

  const serviceCount = services.services.length;
  const readyCount = services.services.filter((service) => service.status === "ready").length;
  const liveCount = services.services.filter((service) => service.status === "live").length;

  return (
    <main className="min-h-screen bg-[#080b10] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#090c12]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.025] text-white/50 transition hover:bg-white/[.05] hover:text-white" aria-label="Back to Control Room"><ArrowLeft size={18} /></Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><CalendarRange size={14} />Service Planner</div>
              <h1 className="mt-1 truncate text-xl font-black tracking-tight sm:text-2xl">{organization.organization_name}</h1>
              <div className="mt-1 truncate text-xs text-white/35">Rundowns, readiness and Edge handoff · {organization.timezone}</div>
            </div>
          </div>
          <CreateServiceDialog
            organizationId={organization.organization_id}
            campuses={campuses.rows}
            bibleVersions={bibleVersions.rows}
            canPlanServices={capabilities.canPlanServices}
          />
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[.13em] text-white/35">Visible plans</span><Layers3 size={17} className="text-[#d7a94a]/65" /></div>
            <div className="mt-2 text-3xl font-black tracking-tight">{serviceCount}</div>
            <div className="mt-1 text-xs text-white/30">Most recent 50 service records</div>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[.13em] text-white/35">Ready</span><ShieldCheck size={17} className="text-emerald-300/70" /></div>
            <div className="mt-2 text-3xl font-black tracking-tight">{readyCount}</div>
            <div className="mt-1 text-xs text-white/30">Validated plans waiting for service</div>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[.13em] text-white/35">Live</span><Sparkles size={17} className="text-red-300/70" /></div>
            <div className="mt-2 text-3xl font-black tracking-tight">{liveCount}</div>
            <div className="mt-1 text-xs text-white/30">Services currently in live state</div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,.18)] sm:p-5 lg:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight">Service plans</h2>
              <p className="mt-1 text-sm text-white/38">Prepare content before worship, validate it, then deliberately promote a plan to Ready.</p>
            </div>
            <div className="text-xs text-white/28">Times shown in {organization.timezone}</div>
          </div>
          <ServicePlannerList
            services={services.services}
            timeZone={organization.timezone}
            canPlanServices={capabilities.canPlanServices}
          />
        </section>
      </div>
    </main>
  );
}
