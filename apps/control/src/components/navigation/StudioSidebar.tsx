"use client";

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Camera,
  Languages,
  LayoutDashboard,
  MonitorPlay,
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
  type StudioNavigationCapabilities,
  type StudioRoute
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

function StudioRouteLink({ route, pathname }: { route: StudioRoute; pathname: string }) {
  const Icon = icons[route.icon];
  const active = isStudioRouteActive(pathname, route.href);
  return (
    <Link
      href={route.href}
      aria-current={active ? "page" : undefined}
      className={
        "group flex w-full items-center justify-center gap-3 rounded-xl border px-3 py-3 text-left transition xl:justify-start " +
        (active
          ? "border-[#d7a94a]/20 bg-[#d7a94a]/10 text-[#f2c765]"
          : "border-transparent text-white/45 hover:bg-white/[.04] hover:text-white/80")
      }
    >
      <Icon size={18} />
      <span className="hidden text-sm font-medium xl:inline">{route.label}</span>
    </Link>
  );
}

export function StudioSidebar({ capabilities }: { capabilities: StudioNavigationCapabilities }) {
  const pathname = usePathname();
  const routes = visibleStudioRoutes(capabilities);
  const primaryRoutes = routes.filter((route) => route.placement === "primary");
  const settingsRoute = routes.find((route) => route.placement === "settings");

  return (
    <aside className="sticky top-0 hidden h-screen border-r border-white/[.07] bg-[#080b10]/95 px-3 py-4 backdrop-blur-xl md:block xl:px-4">
      <div className="mb-7 flex items-center gap-3 px-1 xl:px-2">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#d7a94a]/30 bg-[#d7a94a]/10 text-[#f2c765] shadow-[0_0_35px_rgba(215,169,74,.08)]">
          <MonitorPlay size={22} />
        </div>
        <div className="hidden min-w-0 xl:block">
          <div className="truncate text-sm font-extrabold tracking-tight">iPresenterPlux</div>
          <div className="truncate text-[10px] uppercase tracking-[.22em] text-white/35">AI Church Studio</div>
        </div>
      </div>

      <nav className="space-y-1" aria-label="Studio navigation">
        {primaryRoutes.map((route) => <StudioRouteLink key={route.href} route={route} pathname={pathname} />)}
      </nav>

      {settingsRoute ? (
        <div className="absolute bottom-4 left-3 right-3 xl:left-4 xl:right-4">
          <StudioRouteLink route={settingsRoute} pathname={pathname} />
        </div>
      ) : null}
    </aside>
  );
}
