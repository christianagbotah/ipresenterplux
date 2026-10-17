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
    <aside className="flex min-w-0 flex-col rounded-2xl border border-white/[.08] bg-[#10151e] p-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-sm font-bold text-white/85">Next <span className="rounded-md bg-white/[.06] px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white/50">{model.next.length}</span></h2><div className="mt-1 text-xs text-white/50">Prepare what comes next.</div></div>
        <ListEnd size={18} className="text-[#e1b75e]" aria-hidden="true" />
      </div>
      <div className="mt-4 space-y-2">
        {model.next.length ? model.next.map((item, index) => (
          <div key={item.id} className={`ip-ai-arrive rounded-xl border p-3 ${index === 0 ? "border-[#d7a94a]/25 bg-[#d7a94a]/[.045]" : "border-white/[.06] bg-black/15"}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${index === 0 ? "bg-[#d7a94a]/15 text-[#efc86f]" : "bg-white/[.045] text-white/45"}`}>{String(index + 1).padStart(2, "0")}</div>
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-semibold leading-5 text-white/90">{item.title}</div>
                <div className="mt-1 break-words text-xs leading-5 text-white/55">{item.reason ?? (item.source === "pinned" ? "Your priority" : item.source === "recommendation" ? "AI suggestion" : "From your service plan")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
                  {item.confidence !== null ? <span className="font-bold text-emerald-300/85">{Math.round(item.confidence)}% confidence</span> : null}
                  {item.confidence !== null ? <span className="text-white/30">·</span> : null}
                  <span>{freshnessLabel(item)}</span>
                </div>
              </div>
              {item.source === "pinned" ? <Pin size={13} className="shrink-0 text-[#e1b75e]" /> : null}
            </div>
            {model.service ? <NextItemActions item={item} organizationId={model.organization.id} serviceId={model.service.id} canControl={model.capabilities.canLiveControl} /> : null}
          </div>
        )) : <div className="rounded-xl border border-dashed border-white/[.1] px-4 py-6 text-center"><ListEnd size={24} className="mx-auto mb-3 text-[#efc86f]/60" aria-hidden="true"/><div className="text-sm font-semibold text-white/75">Your next moment starts here</div><p className="mt-2 text-xs leading-5 text-white/55">Add items to your service plan or find a scripture to prepare.</p></div>}
      </div>
      {model.service ? <Link href={`/planner/${model.service.id}`} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.08] text-xs font-bold text-white/55 transition hover:bg-white/[.04] hover:text-white/85 ip-focus-gold">Open Plan <ArrowUpRight size={14}/></Link> : <Link href="/planner" className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.08] text-xs font-bold text-white/55">Open Plan <ArrowUpRight size={14}/></Link>}
    </aside>
  );
}
