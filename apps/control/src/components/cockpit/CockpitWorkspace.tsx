import { AutoRefresh } from "@/components/AutoRefresh";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { CockpitHeader } from "./CockpitHeader";
import { CockpitDepthControls } from "./CockpitDepthControls";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { WhatsNewToast } from "./WhatsNewToast";
import { AttentionLayer } from "./AttentionLayer";
import { CockpitMobile } from "./CockpitMobile";
import { projectCockpitForRole } from "@/lib/cockpit/role-projection";

export function CockpitWorkspace({ model, initialFocusMode = false }: { model: CockpitViewModel; initialFocusMode?: boolean }) {
  const mobileProjection = projectCockpitForRole(model, model.roles);
  return <main className="min-h-screen bg-[#070a0f] text-white">
    <a
      href="#cockpit-content"
      className="ip-focus-gold sr-only z-[200] rounded-lg border border-[#d7a94a]/40 bg-[#0a0f17] px-4 py-2.5 text-sm font-bold text-[#efc86f] focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:shadow-2xl"
    >
      Skip to live cockpit content
    </a>
    {model.service ? <RealtimeRefresh serviceId={model.service.id} /> : <AutoRefresh intervalMs={15_000} />}
    <StudioMobileNav capabilities={model.capabilities} />
    <CommandPalette />
    <ShortcutsHelp />
    {!initialFocusMode ? <WhatsNewToast /> : null}
    <AttentionLayer items={model.attention} />
    <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
      <StudioSidebar capabilities={model.capabilities} />
      <section id="cockpit-content" className="min-w-0 pb-20 md:pb-0 focus:outline-none" tabIndex={-1}>
        <CockpitHeader model={model} />
        <div className="mx-auto max-w-[1900px] p-3 sm:p-4 lg:p-5">
          <CockpitMobile model={model} projection={mobileProjection} />
          <div className="hidden md:block"><CockpitDepthControls model={model} initialFocusMode={initialFocusMode} /></div>
          <div className="mt-4 flex items-center justify-between gap-3 px-1 text-[11px] font-semibold uppercase tracking-[.15em] text-white/40"><span>Prepare → Assist → Preview → Program → Remember</span><span className="text-white/30">Healthy systems stay quiet</span></div>
        </div>
      </section>
    </div>
  </main>;
}
