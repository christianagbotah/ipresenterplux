import Link from "next/link";
import { ArrowRight, Cable, CheckCircle2, CircleOff, FileInput, Replace } from "lucide-react";
import type { CoexistenceBridgeSummary } from "@/lib/imports/coexistence";

export function CoexistenceBridge({ bridges }: { bridges: CoexistenceBridgeSummary[] }) {
  return <section className="border-t border-white/[.07] bg-[#070a0f] text-white">
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="max-w-3xl">
        <div className="text-[11px] font-black uppercase tracking-[.18em] text-[#d7a94a]">Switch without disruption</div>
        <h2 className="mt-2 text-2xl font-black">Import → Coexist → Replace later</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">Move church-owned content first, run documented standards-based bridges alongside the current production path, then retire the old workflow only when your operators are confident.</p>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4"><FileInput size={18} className="text-[#efc86f]"/><div className="mt-3 text-sm font-black">1 · Import existing content</div><p className="mt-2 text-xs leading-5 text-white/55">Bring portable songs, service rundowns and HTTPS media manifests through preview-before-commit.</p></div>
        <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4"><Cable size={18} className="text-emerald-300"/><div className="mt-3 text-sm font-black">2 · Coexist</div><p className="mt-2 text-xs leading-5 text-white/55">Use only bridges already configured in this church workspace. No hidden protocol or proprietary adapter is invented here.</p></div>
        <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4"><Replace size={18} className="text-sky-300"/><div className="mt-3 text-sm font-black">3 · Replace later</div><p className="mt-2 text-xs leading-5 text-white/55">Move the final live-production responsibilities when the team has rehearsed and verified the new workflow.</p></div>
      </div>
      <div className="mt-5 rounded-2xl border border-white/[.08] bg-black/20 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black">Configured coexistence bridges</div><p className="mt-1 text-xs text-white/55">Read from current output-destination configuration; disabled bridges are shown but never represented as active.</p></div><Link href="/streaming" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/[.1] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.04] ip-focus-gold">Streaming Studio <ArrowRight size={14}/></Link></div>
        {bridges.length ? <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{bridges.map((bridge)=><div key={bridge.id} className="ip-ai-arrive rounded-xl border border-white/[.07] bg-white/[.025] p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-white/75">{bridge.name}</div><div className="mt-1 text-[10px] font-black uppercase tracking-[.12em] text-[#d7a94a]">{bridge.protocol}</div></div>{bridge.enabled?<CheckCircle2 size={16} className="text-emerald-300"/>:<CircleOff size={16} className="text-white/40"/>}</div><p className="mt-2 text-xs leading-5 text-white/55">{bridge.purpose}</p><div className="mt-2 text-[10px] uppercase tracking-[.12em] text-white/45">{bridge.enabled?`Configured · ${bridge.status}`:"Configured · disabled"}</div></div>)}</div>:<div className="mt-4 rounded-xl border border-dashed border-white/[.1] p-5 text-sm text-white/50">No NDI, WebRTC or custom RTMPS coexistence bridge is configured for this church yet. Configure only the standards your existing downstream workflow actually supports.</div>}
      </div>
      <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.045] p-4 text-xs leading-5 text-white/60"><strong className="text-amber-100">EasyWorship, ProPresenter, vMix and OBS:</strong> this is protocol coexistence and portable-content migration, <strong className="text-white/65">not native project compatibility</strong>. iPresenterPlux does not claim to open or reverse-engineer proprietary project files.</div>
    </div>
  </section>;
}
