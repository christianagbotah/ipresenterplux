"use client";

import Link from "next/link";
import { BookOpen, Camera, Languages, Music2, RadioTower } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CockpitRoleProjection } from "@/lib/cockpit/role-projection";

function QuickAction({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: React.ReactNode }) {
  return <Link href={href} className="ip-focus-gold flex min-h-12 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.05]">
    <Icon size={16} aria-hidden="true" />{children}
  </Link>;
}

export function MobileQuickActions({ projection }: { projection: CockpitRoleProjection }) {
  const links: Array<{ href: string; label: string; icon: LucideIcon }> = [];
  if (projection.kind === "pastor_service_leader" && projection.actions.canOpenScripture) links.push({ href: "/scripture", label: "Scripture & service references", icon: BookOpen });
  if (projection.kind === "interpreter" && projection.actions.canOpenTranslations) links.push({ href: "/translations", label: "Interpretation workspace", icon: Languages });
  if (projection.kind === "producer" || projection.kind === "media_lead") {
    if (projection.actions.canOpenMedia) links.push({ href: "/media", label: "Media", icon: Music2 });
    if (projection.actions.canOpenCameras) links.push({ href: "/cameras", label: "Sources", icon: Camera });
  }
  if (projection.kind === "producer") {
    if (projection.actions.canOpenTranslations) links.push({ href: "/translations", label: "Languages", icon: Languages });
    if (projection.actions.canOpenStreaming) links.push({ href: "/streaming", label: "Streaming", icon: RadioTower });
  }
  if (!links.length) return null;
  return <div className="grid grid-cols-2 gap-2" aria-label="Live Assist quick actions">
    {links.map((item) => <QuickAction key={`${item.href}:${item.label}`} href={item.href} icon={item.icon}>{item.label}</QuickAction>)}
  </div>;
}
