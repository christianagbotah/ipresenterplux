import Link from "next/link";
import { ChevronDown, CircleDot, PanelsTopLeft } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { ServiceControls } from "@/components/ServiceControls";
import { LogoutButton } from "@/components/auth/LogoutButton";

const domainLinks = [
  ["Scripture", "/scripture"], ["Songs & Media", "/media"], ["Cameras", "/cameras"],
  ["Streaming", "/streaming"], ["Audience", "/audience"], ["Archive", "/archive"], ["Settings", "/settings"]
] as const;

export function CockpitHeader({ model }: { model: CockpitViewModel }) {
  const service = model.service;
  return (
    <header className="sticky top-0 z-40 flex min-h-[68px] items-center justify-between gap-3 border-b border-white/[.07] bg-[#080b10]/92 px-4 backdrop-blur-xl lg:px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <CircleDot size={13} className={service?.status === "live" ? "text-red-400" : "text-emerald-400"} />
          <h1 className="truncate text-sm font-black tracking-tight sm:text-base">{service?.title ?? "Service Cockpit"}</h1>
          {service ? <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[.14em] text-white/45">{service.status}</span> : null}
        </div>
        <div className="mt-1 truncate text-[11px] text-white/32">{model.organization.name}{service?.campusName ? ` · ${service.campusName}` : ""}</div>
      </div>
      <div className="flex items-center gap-2">
        <details className="relative hidden lg:block">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/45 transition hover:bg-white/[.05] hover:text-white/75">
            <PanelsTopLeft size={15} /> Workspaces <ChevronDown size={13} />
          </summary>
          <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-white/[.09] bg-[#0b0f16]/98 p-2 shadow-2xl">
            {domainLinks.map(([label, href]) => <Link key={href} href={href} className="block rounded-xl px-3 py-2.5 text-xs font-semibold text-white/55 hover:bg-white/[.05] hover:text-white">{label}</Link>)}
          </div>
        </details>
        <LogoutButton />
        {service && model.capabilities.canLiveControl ? <ServiceControls serviceId={service.id} status={service.status} showOperatorLink={false} /> : null}
      </div>
    </header>
  );
}
