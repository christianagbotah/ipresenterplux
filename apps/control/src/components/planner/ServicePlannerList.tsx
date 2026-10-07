"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Layers3, MapPin, Radio, Search } from "lucide-react";

export type PlannerServiceSummary = {
  id: string;
  organizationId: string;
  campusId: string | null;
  campusName: string | null;
  title: string;
  serviceType: string;
  status: string;
  scheduledStart: string | null;
  startedAt: string | null;
  endedAt: string | null;
  activeBibleVersion: string;
  createdAt: string;
  updatedAt: string;
  timezone: string;
  itemCount: number;
  edgeAssignmentCount: number;
};

type FilterKey = "upcoming" | "draft" | "ready" | "live" | "archive";

type Props = {
  services: PlannerServiceSummary[];
  timeZone: string;
  canPlanServices: boolean;
};

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "draft", label: "Draft" },
  { key: "ready", label: "Ready" },
  { key: "live", label: "Live" },
  { key: "archive", label: "Ended / Archive" }
];

function filterService(service: PlannerServiceSummary, filter: FilterKey) {
  if (filter === "archive") return service.status === "ended" || service.status === "archived";
  if (filter === "upcoming") {
    if (!['draft', 'ready'].includes(service.status)) return false;
    return !service.scheduledStart || new Date(service.scheduledStart).getTime() >= Date.now();
  }
  return service.status === filter;
}

function statusClasses(status: string) {
  if (status === "live") return "border-red-400/25 bg-red-400/10 text-red-200";
  if (status === "ready") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (status === "draft") return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  return "border-white/10 bg-white/[.04] text-white/55";
}

function formatSchedule(value: string | null, timeZone: string) {
  if (!value) return "Schedule not set";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function prettyServiceType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ServicePlannerList({ services, timeZone, canPlanServices }: Props) {
  const [filter, setFilter] = useState<FilterKey>("upcoming");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return services.filter((service) => {
      if (!filterService(service, filter)) return false;
      if (!needle) return true;
      return [service.title, service.serviceType, service.campusName ?? "", service.activeBibleVersion]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [filter, search, services]);

  const counts = useMemo(() => Object.fromEntries(filters.map(({ key }) => [
    key,
    services.filter((service) => filterService(service, key)).length
  ])), [services]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 ip-scrollbar">
          {filters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                "shrink-0 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition " +
                (filter === key
                  ? "border-[#d7a94a]/35 bg-[#d7a94a]/12 text-[#f2c765]"
                  : "border-white/[.07] bg-white/[.025] text-white/50 hover:bg-white/[.05] hover:text-white/80")
              }
            >
              {label}
              <span className="ml-2 rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-current/75">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <label className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 px-3.5 py-2.5 xl:w-72">
          <Search size={16} className="shrink-0 text-white/30" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search services"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
          />
        </label>
      </div>

      {filtered.length ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((service) => (
            <Link
              key={service.id}
              href={`/planner/${service.id}`}
              className="group min-w-0 rounded-2xl border border-white/[.07] bg-white/[.025] p-4 transition hover:border-[#d7a94a]/25 hover:bg-white/[.04]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold tracking-tight text-white/90">{service.title}</div>
                  <div className="mt-1 truncate text-xs text-white/35">{prettyServiceType(service.serviceType)}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${statusClasses(service.status)}`}>
                  {service.status}
                </span>
              </div>

              <div className="mt-4 space-y-2.5 text-xs text-white/45">
                <div className="flex min-w-0 items-center gap-2">
                  <CalendarClock size={14} className="shrink-0 text-[#d7a94a]/70" />
                  <span className="truncate">{formatSchedule(service.scheduledStart, timeZone)}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <MapPin size={14} className="shrink-0 text-white/30" />
                  <span className="truncate">{service.campusName ?? "All campuses"}</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[.12em] text-white/25">Rundown</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-white/70"><Layers3 size={13} />{service.itemCount}</div>
                </div>
                <div className="rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[.12em] text-white/25">Bible</div>
                  <div className="mt-1 truncate text-sm font-bold text-white/70">{service.activeBibleVersion}</div>
                </div>
                <div className="rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[.12em] text-white/25">Edge</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-white/70"><Radio size={13} />{service.edgeAssignmentCount}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/[.06] pt-3 text-xs">
                <span className="text-white/30">{canPlanServices && ["draft", "ready"].includes(service.status) ? "Open & edit plan" : "Open service plan"}</span>
                <span className="flex items-center gap-1 font-semibold text-[#d7a94a]/75 transition group-hover:text-[#f2c765]">Open <ChevronRight size={14} /></span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/[.09] bg-white/[.015] px-6 py-16 text-center">
          <CalendarClock size={28} className="mx-auto text-white/20" />
          <div className="mt-4 text-sm font-bold text-white/65">No services in this view</div>
          <div className="mx-auto mt-2 max-w-md text-xs leading-5 text-white/35">
            Change the lifecycle filter or search phrase{canPlanServices ? ", or create the next church service plan." : "."}
          </div>
        </div>
      )}
    </section>
  );
}
