import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BadgeDollarSign, ShieldCheck } from "lucide-react";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { requireProductAdminEmail } from "@/lib/licensing/product-admin";
import { LicensingAdmin } from "@/components/licensing/LicensingAdmin";

export const dynamic = "force-dynamic";

type OrganizationRow = { id: string; name: string };
type PlanRow = { id: string; code: string; name: string; default_device_seat_limit: number };

export default async function ProductLicensingAdminPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");
  try {
    requireProductAdminEmail(session.user.email);
  } catch {
    redirect("/");
  }

  const [organizations, plans] = await Promise.all([
    query<OrganizationRow>("select id::text,name from organizations order by name"),
    query<PlanRow>("select id::text,code,name,default_device_seat_limit from subscription_plans where enabled=true order by name")
  ]);

  return (
    <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/50 transition hover:bg-white/[.06] hover:text-white" aria-label="Back to Control Room"><ArrowLeft size={17} /></Link>
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><BadgeDollarSign size={14} /> Lightworld · Commercial Control</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">Product licensing</h1>
              <p className="mt-1 text-sm text-white/35">Issue keys, manage subscription terms and inspect tenant activation state.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[.05] px-3 py-2 text-xs text-emerald-100/75"><ShieldCheck size={14} /> Product-admin only</div>
        </header>

        <LicensingAdmin
          organizations={organizations.rows}
          plans={plans.rows.map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, defaultDeviceSeatLimit: plan.default_device_seat_limit }))}
        />
      </div>
    </main>
  );
}
