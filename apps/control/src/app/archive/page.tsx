import { redirect } from "next/navigation";
import { Search, Video } from "lucide-react";
import { auth } from "@auth";
import { ArchiveList } from "@/components/archive/ArchiveList";
import { WorkspaceShell } from "@/components/navigation/WorkspaceShell";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { listArchivedServices } from "@/lib/archive";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export default async function ArchivePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");
  const params = await searchParams;
  const search = params.q?.trim() || undefined;

  const client = await db.connect();
  try {
    const context = await getCurrentServiceForUser(session.user.id, { client });
    if (!context) redirect("/");
    const result = await listArchivedServices(client, session.user.id, { organizationId: context.organizationId, search, limit: 50, offset: 0 });
    return (
      <WorkspaceShell
        capabilities={context.navigationCapabilities}
        icon={Video}
        title="Service Archive"
        subtitle="Completed services · rundowns, Scripture history, transcript evidence"
      >
        <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <form className="flex w-full max-w-md items-center gap-2" action="/archive" method="get">
            <div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/25" /><input name="q" defaultValue={search ?? ""} placeholder="Search service or church" className="h-11 w-full rounded-xl border border-white/[.09] bg-black/20 pl-9 pr-3 text-sm outline-none placeholder:text-white/20 focus:border-[#e3b75c]/35" /></div>
            <button className="ip-focus-gold min-h-11 cursor-pointer rounded-xl bg-gold px-4 text-sm font-black text-gold-ink hover:bg-[#e6ba5e]">Search</button>
          </form>

          <ArchiveList services={result.services} />
        </div>
      </WorkspaceShell>
    );
  } finally {
    client.release();
  }
}
