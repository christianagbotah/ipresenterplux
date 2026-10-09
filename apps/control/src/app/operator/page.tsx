import { redirect } from "next/navigation";
import { auth } from "@auth";
import { CockpitWorkspace } from "@/components/cockpit/CockpitWorkspace";
import { db } from "@/lib/db";
import { getCockpitViewModel } from "@/lib/cockpit/view-model";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");
  const client = await db.connect();
  try {
    const model = await getCockpitViewModel(client, session.user.id);
    if (!model.service) redirect("/");
    return <CockpitWorkspace model={model} />;
  } finally { client.release(); }
}
