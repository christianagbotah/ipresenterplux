"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from "lucide-react";
import type { CockpitAttentionItem } from "@/lib/cockpit/contracts";

const OPEN_EVENT = "ipresenterplux:attention-open";

export function AttentionLayer({ items }: { items: CockpitAttentionItem[] }) {
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const handler=()=>setOpen(true);
    window.addEventListener(OPEN_EVENT,handler);
    return ()=>window.removeEventListener(OPEN_EVENT,handler);
  },[]);
  useEffect(()=>{
    if(!open) return;
    const onKey=(event:KeyboardEvent)=>{ if(event.key === "Escape"){ event.preventDefault(); setOpen(false); } };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[open]);
  const critical=items.filter((item)=>item.severity==="critical").length;
  const warning=items.filter((item)=>item.severity==="warning").length;
  const label=items.length ? `${critical ? `${critical} critical` : `${warning} need attention`}` : "Systems quiet";

  return <>
    <button type="button" onClick={()=>setOpen(true)} title="Open Attention (A)" className={`fixed bottom-20 right-20 z-40 hidden min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-bold shadow-2xl backdrop-blur-xl ip-focus-gold md:flex ${items.length ? critical ? "border-red-400/25 bg-red-950/90 text-red-100" : "border-amber-400/20 bg-[#17130a]/95 text-amber-100" : "border-white/[.07] bg-[#10151e]/95 text-emerald-200/70"}`}>
      {items.length ? critical ? <ShieldAlert size={15}/> : <AlertTriangle size={15}/> : <CheckCircle2 size={15}/>} {label} <kbd className="rounded border border-current/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] opacity-70">A</kbd>
    </button>
    {open ? <div className="fixed inset-0 z-[170] flex items-start justify-center overflow-y-auto bg-black/65 px-3 py-[8vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Production attention">
      <section className="w-full max-w-3xl rounded-2xl border border-white/[.1] bg-[#0a0f17] shadow-[0_30px_120px_rgba(0,0,0,.7)]">
        <header className="flex items-center justify-between gap-3 border-b border-white/[.07] px-4 py-4"><div><div className="text-[10px] font-black uppercase tracking-[.2em] text-[#e2b85f]">Attention</div><h2 className="mt-1 text-lg font-black">{items.length ? "What needs you now" : "Systems are quiet"}</h2></div><button type="button" onClick={()=>setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-white/45 hover:bg-white/[.05] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40" aria-label="Close attention" autoFocus><X size={18}/></button></header>
        <div className="space-y-3 p-4">
          {items.length ? items.map((item)=><article key={item.id} className={`ip-attention-enter rounded-xl border p-4 ${item.severity==="critical"?"border-red-400/25 bg-red-400/[.06]":"border-amber-400/18 bg-amber-400/[.05]"}`}>
            <div className="flex items-start gap-3">{item.severity==="critical"?<ShieldAlert size={18} className="mt-0.5 shrink-0 text-red-300"/>:<AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300"/>}<div className="min-w-0 flex-1"><div className="text-sm font-black text-white/90">{item.impact}</div><div className="mt-2 text-xs leading-5 text-white/62"><strong className="text-white/78">Contained:</strong> {item.containment}</div><div className="mt-1 text-xs leading-5 text-white/62"><strong className="text-white/78">Do next:</strong> {item.recommendedAction}</div>{item.detailHref?<Link href={item.detailHref} onClick={()=>setOpen(false)} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-white/[.09] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.05] ip-focus-gold">Open details</Link>:null}</div></div>
          </article>) : <div className="py-10 text-center"><CheckCircle2 size={28} className="mx-auto text-emerald-300"/><div className="mt-3 text-sm font-bold text-white/75">No operator action is required.</div><p className="mt-1 text-xs text-white/45">Healthy telemetry stays out of the way until it matters.</p></div>}
        </div>
      </section>
    </div>:null}
  </>;
}
