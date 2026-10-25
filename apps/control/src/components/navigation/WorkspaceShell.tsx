import type { LucideIcon } from "lucide-react";
import { MonitorPlay } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import type { StudioNavigationCapabilities } from "@/components/navigation/studio-routes";

/**
 * The one authenticated shell for every console surface.
 *
 * Sidebar (desktop) + mobile nav + a compact sticky workspace header with the
 * product icon tile, title, and quick links. Replaces the family of
 * standalone hero pages so the whole control plane feels like one product.
 */
export function WorkspaceShell({
  capabilities,
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
  contentId
}: {
  capabilities: StudioNavigationCapabilities;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  contentId?: string;
}) {
  const sectionId = contentId ?? "workspace-content";
  return (
    <main className="min-h-screen bg-console text-white">
      <a
        href={`#${sectionId}`}
        className="ip-focus-gold sr-only z-[200] rounded-lg border border-gold/40 bg-panel px-4 py-2.5 text-sm font-bold text-gold-strong focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:shadow-2xl"
      >
        Skip to {title} content
      </a>
      <StudioMobileNav capabilities={capabilities} />
      <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
        <StudioSidebar capabilities={capabilities} />
        <section id={sectionId} className="min-w-0 pb-20 focus:outline-none md:pb-0" tabIndex={-1}>
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-white/[.07] bg-console-2/92 px-4 backdrop-blur-xl lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold/25 bg-gold/10 text-gold-strong">
                <Icon size={19} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-black sm:text-base">{title}</h1>
                {subtitle ? <p className="truncate text-[11px] text-white/35">{subtitle}</p> : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <Link
                href="/operator"
                className="ip-focus-gold hidden min-h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/50 transition hover:text-white sm:flex"
              >
                <MonitorPlay size={15} aria-hidden="true" /> Operator
              </Link>
              <LogoutButton />
            </div>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
