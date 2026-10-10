import Link from "next/link";
import { Archive, CalendarDays, Search } from "lucide-react";

type Service = {
  id:string; organizationName:string; campusName:string|null; title:string; serviceType:string;
  scheduledStart:string|null; startedAt:string|null; endedAt:string|null;
};

function when(value:string|null) {
  if (!value) return "Time unavailable";
  const date=new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
}

export function ArchiveList({ services, search }: { services: Service[]; search?: string }) {
  return (
    <main className="min-h-screen bg-[#080b10] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-300/85">Service history</div>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black"><Archive className="h-7 w-7 text-amber-300"/>Archive</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Ended services, final rundown, Scripture evidence, transcript summary and retained recording metadata.</p>
          </div>
          <form className="flex w-full max-w-md gap-2" action="/archive">
            <label className="ip-focus-gold flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3">
              <Search className="h-4 w-4 text-white/45"/><input name="q" defaultValue={search ?? ""} placeholder="Search ended services" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-white/40"/>
            </label>
            <button className="ip-focus-gold min-h-11 cursor-pointer rounded-xl bg-amber-300 px-4 text-sm font-black text-black">Search</button>
          </form>
        </div>
        {services.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{services.map(service => (
          <Link key={service.id} href={`/archive/${service.id}`} className="ip-focus-gold ip-ai-arrive group cursor-pointer rounded-2xl border border-white/[.07] bg-white/[.025] p-5 transition hover:border-amber-300/30 hover:bg-white/[.04]">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-lg font-black">{service.title}</div><div className="mt-1 truncate text-xs text-white/55">{service.organizationName}{service.campusName ? ` · ${service.campusName}` : ""}</div></div><span className="rounded-full bg-white/[.06] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white/65">ended</span></div>
            <div className="mt-5 flex items-center gap-2 text-xs text-white/55"><CalendarDays className="h-4 w-4"/>{when(service.endedAt)}</div>
            <div className="mt-4 text-xs font-bold text-amber-300/85 group-hover:text-amber-200">Open service archive →</div>
          </Link>
        ))}</div> : <div className="rounded-2xl border border-dashed border-white/[.09] bg-white/[.02] p-10 text-center text-sm text-white/55">No ended services match this archive view.</div>}
      </div>
    </main>
  );
}
