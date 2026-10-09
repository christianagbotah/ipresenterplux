import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { auth } from "@auth";
import { ImportWizard } from "@/components/imports/ImportWizard";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { db } from "@/lib/db";
import { listPlannerServices, loadPlannerServiceDetail } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

export default async function MediaImportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const client = await db.connect();
  try {
    const context = await getCurrentServiceForUser(session.user.id, { client });
    if (!context) redirect("/");
    if (!context.capabilities.canPlanServices) redirect("/media");

    const listed = await listPlannerServices(client, session.user.id, {
      organizationId: context.organizationId,
      limit: 50,
      offset: 0
    });
    const editableServices: Array<{ id: string; title: string; status: string; revision: string }> = [];
    for (const service of listed.services) {
      if (service.status !== "draft" && service.status !== "ready") continue;
      const detail = await loadPlannerServiceDetail(client, session.user.id, service.id);
      if (!detail.canEdit) continue;
      editableServices.push({
        id: detail.service.id,
        title: detail.service.title,
        status: detail.service.status,
        revision: detail.revision
      });
    }

    const organizationId = context.organizationId;
    return (
      <main className="min-h-screen bg-[#080b10] text-white">
        <StudioMobileNav capabilities={context.capabilities} />
        <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
          <StudioSidebar capabilities={context.capabilities} />
          <section className="min-w-0 pb-20 md:pb-0">
            <header className="border-b border-white/[.07] bg-[#090c12]/90 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
              <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[.18em] text-[#d7a94a]"><Sparkles size={14}/>Switching assistant</div>
                  <div className="mt-1 text-sm text-white/42">Portable, preview-first migration into {context.organizationName}</div>
                </div>
                <Link href="/media" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/[.09] px-4 text-sm font-bold text-white/60 transition hover:bg-white/[.05] hover:text-white"><ArrowLeft size={15}/>Back to Songs & Media</Link>
              </div>
            </header>
            <div className="mx-auto max-w-[1700px] p-4 sm:p-6 lg:p-8">
              <ImportWizard
                organizationId={organizationId}
                organizationName={context.organizationName}
                editableServices={editableServices}
              />
            </div>
          </section>
        </div>
      </main>
    );
  } finally {
    client.release();
  }
}
