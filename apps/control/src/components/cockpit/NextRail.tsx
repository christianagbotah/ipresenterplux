import Link from "next/link";
import { ArrowUpRight, ListEnd, Pin } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { NextItemActions } from "./NextItemActions";

export function NextRail({ model }: { model: CockpitViewModel }) {
  return (
    <aside className="rounded-2xl border border-white/[.07] bg-white/[.018] p-4 xl:min-h-[600px]">
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-[10px] font-black uppercase tracking-[.2em] text-white/28">Next</div><div className="mt-1 text-sm font-bold text-white/70">Prepared service flow</div></div>
        <ListEnd size={17} className="text-[#e1b75e]" />
      </div>
      <div className="mt-4 space-y-2">
        {model.next.length ? model.next.map((item, index) => (
          <div key={item.id} className="rounded-xl border border-white/[.06] bg-black/20 p-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.045] text-[10px] font-black text-white/40">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white/75">{item.title}</div>
                <div className="mt-1 text-[11px] text-white/30">{item.targetType.replaceAll("_", " ")} · {item.reason ?? item.source}</div>
                {item.confidence !== null ? <div className="mt-1 text-[10px] font-bold text-emerald-300/75">{Math.round(item.confidence)}% confidence</div> : null}
              </div>
              {item.source === "pinned" ? <Pin size={13} className="text-[#e1b75e]" /> : null}
            </div>
            {model.service ? <NextItemActions item={item} organizationId={model.organization.id} serviceId={model.service.id} canControl={model.capabilities.canLiveControl} /> : null}
          </div>
        )) : <div className="rounded-xl border border-dashed border-white/[.08] p-6 text-center text-xs leading-5 text-white/32">No queued item. The service can still be operated manually.</div>}
      </div>
      {model.service ? <Link href={`/planner/${model.service.id}`} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.08] text-xs font-bold text-white/45 transition hover:bg-white/[.04] hover:text-white/75">Open Plan <ArrowUpRight size={14}/></Link> : <Link href="/planner" className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.08] text-xs font-bold text-white/45">Open Plan <ArrowUpRight size={14}/></Link>}
    </aside>
  );
}
