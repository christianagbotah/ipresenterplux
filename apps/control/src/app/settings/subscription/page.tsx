import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ArrowLeft, BadgeCheck, CreditCard } from "lucide-react";
import { auth } from "@auth";
import { db, query } from "@/lib/db";
import { DEVICE_ADMIN_ROLES } from "@/lib/rbac";
import { deactivateOrganizationActivation, getOrganizationSubscriptionOverview } from "@/lib/licensing/licensing-admin-service";
import { SubscriptionStatus } from "@/components/licensing/SubscriptionStatus";

export const dynamic = "force-dynamic";

type MembershipRow = { id: string; name: string; roles: string[] };

type ScopedSubscriptionRow = { id: string };

export default async function SubscriptionSettingsPage() {
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
  if (!organization) redirect("/");
  const canManage = organization.roles.some((role) => DEVICE_ADMIN_ROLES.includes(role as never));
  if (!canManage) redirect("/");

  const scopedSubscription = await query<ScopedSubscriptionRow>(
    `select id::text
     from organization_subscriptions
     where organization_id=$1
     order by case when status in ('trial','active','past_due','suspended') then 0 else 1 end,created_at desc
     limit 1`,
    [organization.id]
  );
  const overview = scopedSubscription.rows[0]
    ? await getOrganizationSubscriptionOverview(db, organization.id)
    : {
        organizationId: organization.id,
        organizationName: organization.name,
        subscription: null,
        seats: { limit: 0, used: 0 },
        activations: []
      };

  async function deactivateAction(formData: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.id) redirect("/login");
    const activationId = String(formData.get("activationId") ?? "");
    if (!/^[0-9a-f-]{36}$/iu.test(activationId)) return;

    const allowed = await query<{ allowed: boolean }>(
      `select exists(
         select 1 from user_organization_roles uor
         where uor.user_id=$1 and uor.organization_id=$2
           and uor.role_id = any($3::text[])
       ) as allowed`,
      [current.user.id, organization.id, [...DEVICE_ADMIN_ROLES]]
    );
    if (!allowed.rows[0]?.allowed) redirect("/");

    const client = await db.connect();
    try {
      await client.query("begin");
      await deactivateOrganizationActivation(client, {
        organizationId: organization.id,
        activationId,
        actorUserId: current.user.id,
        reason: "Deactivated from church subscription settings"
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    revalidatePath("/settings/subscription");
  }

  return (
    <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/settings" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/50 transition hover:bg-white/[.06] hover:text-white" aria-label="Back to settings">
              <ArrowLeft size={17} />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><CreditCard size={13} /> Settings · Subscription</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">Subscription & activation</h1>
              <p className="mt-1 text-sm text-white/35">{organization.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[.05] px-3 py-2 text-xs text-emerald-100/75">
            <BadgeCheck size={14} /> Tenant-scoped commercial status
          </div>
        </header>
        <SubscriptionStatus overview={overview} canManage={canManage} deactivateAction={deactivateAction} />
      </div>
    </main>
  );
}
