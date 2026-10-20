import Link from "next/link";
import { Brain, CalendarDays } from "lucide-react";

type Service={id:string;organizationName:string;campusName:string|null;title:string;serviceType:string;scheduledStart:string|null;startedAt:string|null;endedAt:string|null;memoryStatus:string|null;memorySummary:string|null;memoryGeneratedAt:string|null;memoryChapterCount:number};
function when(value:string|null){if(!value)return "Time unavailable";const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString():"Time unavailable";}
export function ArchiveList({services}:{services:Service[]}){
  return services.length?<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{services.map(service=><Link key={service.id} href={`/archive/${service.id}`} className="ip-focus-gold ip-ai-arrive group min-h-44 rounded-2xl border border-white/[.07] bg-white/[.025] p-5 transition hover:border-amber-300/30 hover:bg-white/[.04]">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-lg font-black">{service.title}</div><div className="mt-1 truncate text-xs text-white/55">{service.organizationName}{service.campusName?` · ${service.campusName}`:""}</div></div><span className="rounded-full bg-white/[.06] px-2 py-1 text-xs font-bold uppercase tracking-wide text-white/65">ended</span></div>
    <div className="mt-4 flex items-center gap-2 text-xs text-white/55"><CalendarDays className="h-4 w-4"/>{when(service.endedAt)}</div>
    {service.memorySummary?<div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/[.04] p-3"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[.12em] text-amber-200/80"><Brain size={13}/>Remembered · {service.memoryChapterCount} chapter{service.memoryChapterCount===1?"":"s"}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-white/58">{service.memorySummary}</p></div>:null}
    <div className="mt-4 text-xs font-bold text-amber-300/85 group-hover:text-amber-200">Open service memory →</div>
  </Link>)}</div>:<div className="rounded-2xl border border-dashed border-white/[.09] bg-white/[.02] p-10 text-center text-sm text-white/55">No ended services match this archive view.</div>;
}
