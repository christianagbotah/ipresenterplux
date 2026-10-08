import { AutoRefresh } from "@/components/AutoRefresh";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { CockpitHeader } from "./CockpitHeader";
import { NextRail } from "./NextRail";
import { NowRail } from "./NowRail";
import { ProgramPreviewStage } from "./ProgramPreviewStage";

export function CockpitWorkspace({ model }: { model: CockpitViewModel }) {
  return <main className="min-h-screen bg-[#070a0f] text-white">
    {model.service ? <RealtimeRefresh serviceId={model.service.id} /> : <AutoRefresh intervalMs={15_000} />}
    <StudioMobileNav capabilities={model.capabilities} />
    <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
      <StudioSidebar capabilities={model.capabilities} />
      <section className="min-w-0 pb-20 md:pb-0">
        <CockpitHeader model={model} />
        <div className="mx-auto max-w-[1900px] p-3 sm:p-4 lg:p-5">
          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
            <NowRail model={model} />
            <section className="min-w-0"><ProgramPreviewStage model={model} /></section>
            <NextRail model={model} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 px-1 text-[10px] uppercase tracking-[.15em] text-white/20"><span>Prepare → Assist → Preview → Program → Remember</span><span>Healthy systems stay quiet</span></div>
        </div>
      </section>
    </div>
  </main>;
}
