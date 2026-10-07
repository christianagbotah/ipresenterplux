import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import DashboardPage from "./DashboardPage";
import { query } from "@/lib/db";
import { roleCapabilities } from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const roles = await query<{ role_id: string }>(
    `select distinct role_id
     from user_organization_roles
     where user_id=$1
     order by role_id`,
    [session.user.id]
  );
  const capabilities = roleCapabilities(roles.rows.map((row) => row.role_id));

  return (
    <>
      <DashboardPage />
      {capabilities.canViewPlanner ? (
        <Link
          href="/planner"
          className="fixed bottom-20 left-3 z-50 flex min-h-11 w-[62px] items-center justify-center gap-3 rounded-xl border border-[#d7a94a]/25 bg-[#17140e]/95 px-3 py-3 text-[#f2c765] shadow-[0_14px_38px_rgba(0,0,0,.35)] backdrop-blur-xl transition hover:bg-[#d7a94a]/15 xl:left-4 xl:w-[208px] xl:justify-start"
          aria-label="Open Service Planner"
        >
          <CalendarRange size={18} />
          <span className="hidden text-sm font-semibold xl:inline">Service Planner</span>
        </Link>
      ) : null}
    </>
  );
}
