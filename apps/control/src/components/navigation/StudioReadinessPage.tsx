import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import { getCurrentServiceForUser } from "@/lib/current-service";

async function readinessContext(userId: string) {
  return getCurrentServiceForUser(userId);
}

export async function StudioReadinessPage({
  title,
  eyebrow,
  description,
  detail,
  icon: Icon,
  actionHref,
  actionLabel,
  secondaryHref = "/",
  secondaryLabel = "Control Room"
}: {
  title: string;
  eyebrow: string;
  description: string;
  detail: string;
  icon: LucideIcon;
  actionHref: string;
  actionLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const context = await readinessContext(session.user.id);
  const capabilities = context?.navigationCapabilities ?? { canMedia:false, canCameras:false, canAIDirector:false, canTranslations:false, canStreaming:false, canArchive:false, canSettings:false };

  return (
    <main className="min-h-screen bg-[#070a0f] text-white">
      <StudioMobileNav capabilities={capabilities} />
      <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
        <StudioSidebar capabilities={capabilities} />
        <section className="min-w-0 pb-20 md:pb-0">
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-white/[.07] bg-[#080b10]/92 px-4 backdrop-blur-xl lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86f]">
                <Icon size={19} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-black sm:text-base">{title}</h1>
                <p className="truncate text-[11px] text-white/35">{eyebrow}</p>
              </div>
            </div>
            <LogoutButton />
          </header>

          <div className="mx-auto max-w-5xl p-4 lg:p-8">
            <section className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0b0f16]">
              <div className="border-b border-white/[.06] p-6 sm:p-8">
                <div className="flex items-center gap-2 text-[#e5b95e]">
                  <CheckCircle2 size={16} />
                  <span className="text-[10px] font-black uppercase tracking-[.16em]">Route connected · readiness workspace</span>
                </div>
                <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">{description}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-white/48">{detail}</p>
              </div>

              <div className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8">
                <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                  <div className="text-[10px] font-black uppercase tracking-[.14em] text-white/30">Current service</div>
                  <div className="mt-2 text-base font-black text-white/75">{context?.service?.title ?? "No service selected"}</div>
                  <div className="mt-1 text-xs capitalize text-white/35">{context?.service?.status ?? "Create or prepare a service to continue"}</div>
                </div>
                <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                  <div className="text-[10px] font-black uppercase tracking-[.14em] text-white/30">Production truth</div>
                  <div className="mt-2 flex items-center gap-2 text-sm font-bold text-white/65"><MonitorPlay size={15} /> Existing live controls remain authoritative</div>
                  <div className="mt-1 text-xs leading-5 text-white/35">This screen does not claim hardware, AI, archive, or media capabilities that are not connected yet.</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-white/[.06] p-6 sm:p-8">
                <Link href={actionHref} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#17120a] transition hover:bg-[#e7bd63]">
                  {actionLabel} <ArrowRight size={15} />
                </Link>
                <Link href={secondaryHref} className="inline-flex min-h-11 items-center rounded-xl border border-white/[.09] bg-white/[.03] px-4 text-sm font-bold text-white/60 transition hover:bg-white/[.06] hover:text-white">
                  {secondaryLabel}
                </Link>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
