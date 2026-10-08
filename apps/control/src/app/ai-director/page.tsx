import { redirect } from "next/navigation";
import { auth } from "@auth";
import { AIDirectorWorkspace } from "@/components/ai-director/AIDirectorWorkspace";
import { db, query } from "@/lib/db";
import { getAIDirectorState } from "@/lib/ai-director";

export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id: string;
  organization_name: string;
};

export default async function AIDirectorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const membership = await query<MembershipRow>(
    `select o.id::text as organization_id,o.name as organization_name
       from user_organization_roles uor
       join organizations o on o.id=uor.organization_id
      where uor.user_id=$1
      order by uor.granted_at,o.name,o.id
      limit 1`,
    [session.user.id]
  );
  const organization = membership.rows[0];

  if (!organization) {
    return (
      <main className="min-h-screen bg-[#080b10] px-4 py-12 text-white sm:px-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-white/[.08] bg-white/[.025] p-8 text-center">
          <h1 className="text-xl font-black">AI Director</h1>
          <p className="mt-2 text-sm leading-6 text-white/40">Your account is not assigned to a church workspace yet.</p>
        </div>
      </main>
    );
  }

  const client = await db.connect();
  try {
    const state = await getAIDirectorState(client, session.user.id, {
      organizationId: organization.organization_id
    });
    return <AIDirectorWorkspace organizationName={organization.organization_name} state={state} />;
  } finally {
    client.release();
  }
}
