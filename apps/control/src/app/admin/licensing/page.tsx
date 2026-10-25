import { redirect } from "next/navigation";
import { BadgeDollarSign } from "lucide-react";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { requireProductAdminEmail } from "@/lib/licensing/product-admin";
import { LicensingAdmin } from "@/components/licensing/LicensingAdmin";
import { WorkspaceShell } from "@/components/navigation/WorkspaceShell";

export const dynamic = "force-dynamic";

type OrganizationRow = { id: string; name: string };
type PlanRow = { id: string; code: string; name: string; enabled: boolean; default_device_seat_limit: number; features: Record<string, boolean> };

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
    query<PlanRow>("select id::text,code,name,enabled,default_device_seat_limit,features from subscription_plans order by name,code")
  ]);

  return (
    <WorkspaceShell
      capabilities={{
        canMedia: false,
        canViewPlanner: false,
        canCameras: false,
        canAIDirector: false,
        canTranslations: false,
        canStreaming: false,
        canArchive: false,
        canSettings: false
      }}
      icon={BadgeDollarSign}
      title="Product Licensing"
      subtitle="Lightworld commercial control · product-admin only"
    >
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <LicensingAdmin
          organizations={organizations.rows}
          plans={plans.rows.map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, enabled: plan.enabled, defaultDeviceSeatLimit: plan.default_device_seat_limit, features: plan.features ?? {} }))}
        />
      </div>
    </WorkspaceShell>
  );
}
