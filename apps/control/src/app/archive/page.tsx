import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { auth } from "@auth";
import { ArchiveList } from "@/components/archive/ArchiveList";
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
      <main className="min-h-screen bg-[#080b10] text-white">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <section className="rounded-3xl border border-white/[.07] bg-[radial-gradient(circle_at_top_right,rgba(215,169,74,.11),transparent_34%),#0c1017] p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#d7a94a]">Service Archive</div>
                <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Completed services</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/40">Review final rundowns, Scripture history, transcript/caption evidence, and retained recording or media metadata from completed services.</p>
              </div>
              <form className="flex w-full max-w-md items-center gap-2" action="/archive" method="get">
                <div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/25" /><input name="q" defaultValue={search ?? ""} placeholder="Search service or church" className="h-11 w-full rounded-xl border border-white/[.09] bg-black/20 pl-9 pr-3 text-sm outline-none placeholder:text-white/20 focus:border-[#d7a94a]/35" /></div>
                <button className="min-h-11 cursor-pointer rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#171005] hover:brightness-110">Search</button>
              </form>
            </div>
          </section>

          <ArchiveList services={result.services} />
        </div>
      </main>
    );
  } finally {
    client.release();
  }
}
