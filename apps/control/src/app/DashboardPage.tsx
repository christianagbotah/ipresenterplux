import { redirect } from "next/navigation";
import { auth } from "@auth";
import { CockpitWorkspace } from "@/components/cockpit/CockpitWorkspace";
import { db } from "@/lib/db";
import { getCockpitViewModel } from "@/lib/cockpit/view-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");
  const client = await db.connect();
  try {
    const model = await getCockpitViewModel(client, session.user.id);
    return <CockpitWorkspace model={model} />;
  } finally { client.release(); }
}
