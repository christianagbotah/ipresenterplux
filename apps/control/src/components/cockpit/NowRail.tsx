import { AudioLines, Camera, Languages, RadioTower, UserRound } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";

function freshnessMeta(value: string) {
  if (value === "current") return { label: "Current", dot: "bg-emerald-400", text: "text-emerald-300" };
  if (value === "stale") return { label: "Stale", dot: "bg-amber-400", text: "text-amber-300" };
  return { label: "Unavailable", dot: "bg-white/25", text: "text-white/40" };
}

export function NowRail({ model }: { model: CockpitViewModel }) {
  const camera = freshnessMeta(model.systems.camera.freshness);
  const audio = freshnessMeta(model.systems.audio.freshness);
  return (
    <aside className="space-y-5 rounded-2xl border border-white/[.07] bg-white/[.018] p-4 xl:min-h-[600px]">
      <div>
        <div className="text-xs font-black uppercase tracking-[.2em] text-white/45">Now</div>
        <div className="mt-2 text-lg font-black text-white/90">{model.now.currentContent?.title ?? "Program is clear"}</div>
        <div className="mt-1 text-xs text-white/50">{model.now.currentContent ? model.now.currentContent.contentType.replaceAll("_", " ") : "Waiting for live content"}</div>
      </div>
      <div className="border-t border-white/[.06] pt-4">
        <div className="flex items-center gap-2 text-xs font-bold text-white/65"><UserRound size={14} /> Speaker context</div>
        <div className="mt-2 text-sm text-white/80">{model.now.speakerId ?? "Speaker not identified"}</div>
        <p className="mt-2 line-clamp-5 text-xs leading-5 text-white/55">{model.now.transcriptText ?? "Listening for the next transcript segment…"}</p>
      </div>
      <div className="border-t border-white/[.06] pt-4 text-xs">
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/50"><Camera size={14}/> Camera</span><span className={`flex items-center gap-1.5 font-semibold ${camera.text}`}><span className={`size-1.5 rounded-full ${camera.dot}`} />{model.systems.camera.activeName ?? "Unavailable"}<span className="text-xs font-normal text-white/35">· {camera.label}</span></span></div>
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/50"><AudioLines size={14}/> Audio</span><span className={`flex items-center gap-1.5 font-semibold ${audio.text}`}><span className={`size-1.5 rounded-full ${audio.dot}`} />{model.systems.audio.activeName ?? "Unavailable"}<span className="text-xs font-normal text-white/35">· {audio.label}</span></span></div>
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/50"><RadioTower size={14}/> Outputs</span><span className="font-semibold text-white/70">{model.systems.outputs.enabled} active</span></div>
        <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-white/50"><Languages size={14}/> Audience</span><span className="font-semibold text-white/70">{model.systems.audience.listeners} listeners</span></div>
      </div>
    </aside>
  );
}
