"use client";

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Camera,
  ChevronUp,
  Languages,
  LayoutDashboard,
  Menu,
  Music2,
  RadioTower,
  Settings2,
  Users,
  Video
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isStudioRouteActive,
  visibleStudioRoutes,
  type StudioIconKey,
  type StudioNavigationCapabilities
} from "./studio-routes";

const icons: Record<StudioIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  scripture: BookOpen,
  media: Music2,
  camera: Camera,
  ai: Bot,
  translations: Languages,
  streaming: RadioTower,
  audience: Users,
  archive: Video,
  settings: Settings2
};

export function StudioMobileNav({ capabilities }: { capabilities: StudioNavigationCapabilities }) {
  const pathname = usePathname();
  const routes = visibleStudioRoutes(capabilities);
  const active = routes.find((route) => isStudioRouteActive(pathname, route.href));

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 md:hidden">
      <details className="group relative">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-2xl border border-white/[.1] bg-[#0b0f16]/96 px-4 text-sm font-bold text-white shadow-2xl backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a94a]">
          <span className="flex min-w-0 items-center gap-2">
            <Menu size={17} className="text-[#e5b95e]" />
            <span className="truncate">{active?.label ?? "Studio"}</span>
          </span>
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-white/35">
            Menu <ChevronUp size={14} className="transition group-open:rotate-180" />
          </span>
        </summary>

        <nav className="absolute bottom-14 left-0 right-0 grid max-h-[70vh] grid-cols-2 gap-2 overflow-y-auto rounded-2xl border border-white/[.1] bg-[#090d14]/98 p-3 shadow-2xl backdrop-blur-xl" aria-label="Mobile studio navigation">
          {routes.map((route) => {
            const Icon = icons[route.icon];
            const routeActive = isStudioRouteActive(pathname, route.href);
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={routeActive ? "page" : undefined}
                className={
                  "flex min-h-12 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition " +
                  (routeActive
                    ? "border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#f2c765]"
                    : "border-white/[.06] bg-white/[.025] text-white/60 hover:bg-white/[.05] hover:text-white")
                }
              >
                <Icon size={16} />
                <span>{route.label}</span>
              </Link>
            );
          })}
        </nav>
      </details>
    </div>
  );
}
