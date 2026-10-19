"use client";

import Link from "next/link";
import { BookOpen, CalendarRange, LayoutDashboard, LibraryBig, Users } from "lucide-react";
import type { CockpitRoleProjection } from "@/lib/cockpit/role-projection";

export type MobileLiveAssistDestination = "live" | "scripture" | "service" | "media_sources" | "audience";

export function MobileBottomNav({ projection, active }: { projection: CockpitRoleProjection; active: MobileLiveAssistDestination }) {
  const destinations = [
    { id: "live" as const, label: "Live", href: "/", icon: LayoutDashboard, visible: true },
    { id: "scripture" as const, label: "Scripture", href: "/scripture", icon: BookOpen, visible: projection.actions.canOpenScripture },
    { id: "service" as const, label: "Service", href: "/planner", icon: CalendarRange, visible: projection.actions.canOpenService },
    { id: "media_sources" as const, label: "Media", href: projection.actions.canOpenMedia ? "/media" : "/cameras", icon: LibraryBig, visible: projection.actions.canOpenMedia || projection.actions.canOpenCameras },
    { id: "audience" as const, label: "Audience", href: "/audience", icon: Users, visible: projection.actions.canOpenAudience }
  ].filter((item) => item.visible);

  return <nav className="fixed inset-x-0 bottom-0 z-50 flex gap-1 border-t border-white/[.09] bg-[#080b10]/96 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(0,0,0,.28)] backdrop-blur-xl md:hidden" aria-label="Live Assist navigation">
    {destinations.map((item) => {
      const Icon = item.icon;
      const selected = item.id === active;
      return <Link key={item.id} href={item.href} aria-current={selected ? "page" : undefined} className={`ip-focus-gold flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[9px] font-bold transition ${selected ? "bg-[#d7a94a]/12 text-[#f2c765]" : "text-white/45 hover:bg-white/[.05] hover:text-white/80"}`}>
        <Icon size={16} aria-hidden="true" /><span className="truncate">{item.label}</span>
      </Link>;
    })}
  </nav>;
}
