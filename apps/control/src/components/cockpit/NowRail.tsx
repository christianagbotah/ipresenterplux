import { AudioLines, Camera, MonitorPlay, RadioTower, Users, UserRound } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";

function freshnessMeta(value: string) {
  if (value === "current") return { label: "Current", dot: "bg-emerald-400", text: "text-emerald-300" };
  if (value === "stale") return { label: "Stale", dot: "bg-amber-400", text: "text-amber-300" };
  return { label: "Unavailable", dot: "bg-white/25", text: "text-white/40" };
}

export function NowRail({ model }: { model: CockpitViewModel }) {
  const camera = freshnessMeta(model.systems.camera.freshness);
  const visualProgram = freshnessMeta(model.systems.visualProgram.freshness);
  const visualProgramProblem = ["disconnected", "error"].includes(model.systems.visualProgram.captureStatus ?? "");
  const audio = freshnessMeta(model.systems.audio.freshness);
  return (
    <aside className="space-y-4 rounded-2xl border border-white/[.08] bg-[#121a26] p-4">
      <div>
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-white/85">Now</h2><span className="rounded-md bg-white/[.05] px-2 py-1 text-xs text-white/50">Live context</span></div>
        <div className="mt-3 break-words text-lg font-bold leading-snug text-white/95">{model.now.currentContent?.title ?? "Program is clear"}</div>
        <div className="mt-1 text-xs capitalize text-white/50">{model.now.currentContent ? model.now.currentContent.contentType.replaceAll("_", " ") : "Waiting for live content"}</div>
      </div>
      <div className="rounded-xl border border-white/[.05] bg-black/15 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/65"><UserRound size={14} aria-hidden="true" />{model.now.speakerId ? "Speaker identified" : "Live speech"}</div>
        <p className="mt-2 line-clamp-4 text-sm leading-6 text-white/70">{model.now.transcriptText ?? "Speech will appear here when a transcript is available."}</p>
      </div>
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-white/55"><Camera size={14}/> Camera</span><span className={`flex min-w-0 items-center gap-1.5 font-semibold ${camera.text}`} title={model.systems.camera.activeName ?? camera.label}><span className={`size-1.5 shrink-0 rounded-full ${camera.dot}`} /><span className="max-w-32 truncate">{model.systems.camera.activeName ?? "Not connected"}</span><span className="sr-only"> · {camera.label}</span></span></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-white/55"><MonitorPlay size={14}/> Visual Program</span><span className={`flex min-w-0 items-center gap-1.5 font-semibold ${visualProgramProblem ? "text-red-300" : visualProgram.text}`} title={model.systems.visualProgram.name ?? "No Edge-confirmed Program source"}><span className={`size-1.5 shrink-0 rounded-full ${visualProgramProblem ? "bg-red-400" : visualProgram.dot}`} /><span className="max-w-32 truncate">{model.systems.visualProgram.name ?? "Not confirmed"}</span><span className="sr-only"> · Program source · {model.systems.visualProgram.captureStatus ?? visualProgram.label}</span></span></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-white/55"><AudioLines size={14}/> Audio</span><span className={`flex min-w-0 items-center gap-1.5 font-semibold ${audio.text}`} title={model.systems.audio.activeName ?? audio.label}><span className={`size-1.5 shrink-0 rounded-full ${audio.dot}`} /><span className="max-w-32 truncate">{model.systems.audio.activeName ?? "Not connected"}</span><span className="sr-only"> · {audio.label}</span></span></div>
        <div className="grid grid-cols-2 gap-2 border-t border-white/[.06] pt-3">
          <div className="rounded-lg bg-white/[.025] px-3 py-2.5"><span className="flex items-center gap-1.5 text-white/50"><RadioTower size={13}/>Outputs</span><div className="mt-1 text-sm font-semibold text-white/85">{model.systems.outputs.healthy}<span className="text-xs font-normal text-white/50"> / {model.systems.outputs.enabled} ready</span></div></div>
          <div className="rounded-lg bg-white/[.025] px-3 py-2.5"><span className="flex items-center gap-1.5 text-white/50"><Users size={13}/>Audience</span><div className="mt-1 text-sm font-semibold text-white/85">{model.systems.audience.listeners}<span className="text-xs font-normal text-white/50"> listening</span></div></div>
        </div>
      </div>
    </aside>
  );
}
