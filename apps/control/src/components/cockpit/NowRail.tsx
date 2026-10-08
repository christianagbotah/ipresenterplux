import { AudioLines, Camera, Languages, RadioTower, UserRound } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";

function freshnessClass(value: string) {
  return value === "current" ? "text-emerald-300" : value === "stale" ? "text-amber-300" : "text-white/30";
}

export function NowRail({ model }: { model: CockpitViewModel }) {
  return (
    <aside className="space-y-5 rounded-2xl border border-white/[.07] bg-white/[.018] p-4 xl:min-h-[600px]">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[.2em] text-white/28">Now</div>
        <div className="mt-2 text-lg font-black text-white/85">{model.now.currentContent?.title ?? "Program is clear"}</div>
        <div className="mt-1 text-xs text-white/35">{model.now.currentContent ? model.now.currentContent.contentType.replaceAll("_", " ") : "Waiting for live content"}</div>
      </div>
      <div className="border-t border-white/[.06] pt-4">
        <div className="flex items-center gap-2 text-xs font-bold text-white/60"><UserRound size={14} /> Speaker context</div>
        <div className="mt-2 text-sm text-white/70">{model.now.speakerId ?? "Speaker not identified"}</div>
        <p className="mt-2 line-clamp-5 text-xs leading-5 text-white/38">{model.now.transcriptText ?? "Listening for the next transcript segment…"}</p>
      </div>
      <div className="border-t border-white/[.06] pt-4 text-xs">
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/45"><Camera size={14}/> Camera</span><span className={freshnessClass(model.systems.camera.freshness)}>{model.systems.camera.activeName ?? "Unavailable"}</span></div>
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/45"><AudioLines size={14}/> Audio</span><span className={freshnessClass(model.systems.audio.freshness)}>{model.systems.audio.activeName ?? "Unavailable"}</span></div>
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/45"><RadioTower size={14}/> Outputs</span><span className="text-white/60">{model.systems.outputs.enabled} active</span></div>
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/45"><Languages size={14}/> Audience</span><span className="text-white/60">{model.systems.audience.listeners} listeners</span></div>
      </div>
    </aside>
  );
}
