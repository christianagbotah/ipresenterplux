import Link from "next/link";
import { ArrowUpRight, ListEnd, Pin } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { NextItemActions } from "./NextItemActions";

function freshnessLabel(item: { observedAt: string | null; freshUntil: string | null; source: string }) {
  if (item.source === "pinned") return "Pinned by operator";
  if (!item.observedAt) return "Awaiting signal";
  const observed = new Date(item.observedAt);
  if (!Number.isFinite(observed.getTime())) return "Recent";
  const secondsAgo = Math.round((Date.now() - observed.getTime()) / 1000);
  if (Number.isFinite(secondsAgo) && secondsAgo >= 0) {
    if (secondsAgo < 60) return `detected ${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `detected ${Math.round(secondsAgo / 60)} min ago`;
  }
  return "observed earlier";
}

export function NextRail({ model }: { model: CockpitViewModel }) {
  return (
    <aside className="flex flex-col rounded-2xl border border-white/[.07] bg-white/[.018] p-4 xl:min-h-[600px]">
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-xs font-black uppercase tracking-[.2em] text-white/45">Next</div><div className="mt-1 text-sm font-bold text-white/75">Prepared service flow</div></div>
        <ListEnd size={17} className="text-[#e1b75e]" />
      </div>
      <div className="ip-scrollbar-thin mt-4 -mr-2 flex-1 space-y-2 overflow-y-auto pr-2">
        {model.next.length ? model.next.map((item, index) => (
          <div key={item.id} className="ip-ai-arrive rounded-xl border border-white/[.06] bg-black/25 p-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.045] text-xs font-black text-white/45">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white/85">{item.title}</div>
                <div className="mt-1 text-xs text-white/55">{item.targetType.replaceAll("_", " ")} · {item.reason ?? item.source}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
                  {item.confidence !== null ? <span className="font-bold text-emerald-300/85">{Math.round(item.confidence)}% confidence</span> : null}
                  <span className="text-white/30">·</span>
                  <span>{freshnessLabel(item)}</span>
                </div>
              </div>
              {item.source === "pinned" ? <Pin size={13} className="shrink-0 text-[#e1b75e]" /> : null}
            </div>
            {model.service ? <NextItemActions item={item} organizationId={model.organization.id} serviceId={model.service.id} canControl={model.capabilities.canLiveControl} /> : null}
          </div>
        )) : <div className="rounded-xl border border-dashed border-white/[.08] p-6 text-center text-xs leading-5 text-white/50">No queued item. The service can still be operated manually.</div>}
      </div>
      {model.service ? <Link href={`/planner/${model.service.id}`} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.08] text-xs font-bold text-white/55 transition hover:bg-white/[.04] hover:text-white/85 ip-focus-gold">Open Plan <ArrowUpRight size={14}/></Link> : <Link href="/planner" className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.08] text-xs font-bold text-white/55">Open Plan <ArrowUpRight size={14}/></Link>}
    </aside>
  );
}
