import { MonitorPlay, ShieldCheck, Sparkles } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/[.08] bg-[#0b0f16]/95 shadow-[0_35px_120px_rgba(0,0,0,.45)] lg:grid-cols-[1.15fr_.85fr]">
        <section className="hidden min-h-[650px] border-r border-white/[.07] p-10 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86d]">
                <MonitorPlay size={23} />
              </div>
              <div>
                <div className="text-lg font-black tracking-tight">iPresenterPlux</div>
                <div className="text-[10px] uppercase tracking-[.24em] text-white/30">AI Church Studio</div>
              </div>
            </div>

            <div className="mt-24 max-w-xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d7a94a]/20 bg-[#d7a94a]/[.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.18em] text-[#e8bd62]">
                <Sparkles size={13} />
                Intelligent worship production
              </div>
              <h1 className="text-5xl font-black leading-[1.03] tracking-[-.045em]">
                Presentation, broadcast and interpretation in one control room.
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-white/42">
                Run scripture, cameras, livestream destinations, AI assistance and multilingual audience channels from a single secure platform.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/28">
            <ShieldCheck size={15} className="text-emerald-400/75" />
            Secure operator access · audited live actions
          </div>
        </section>

        <section className="flex min-h-[650px] items-center p-6 sm:p-10">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#d7a94a]/10 text-[#efc86d]">
                  <MonitorPlay size={21} />
                </div>
                <div>
                  <div className="font-black">iPresenterPlux</div>
                  <div className="text-[10px] uppercase tracking-[.22em] text-white/30">AI Church Studio</div>
                </div>
              </div>
            </div>

            <div className="text-xs font-semibold uppercase tracking-[.16em] text-[#d7a94a]">Secure sign in</div>
            <h2 className="mt-2 text-3xl font-black tracking-[-.03em]">Open the control room</h2>
            <p className="mt-2 text-sm leading-6 text-white/38">
              Sign in with an authorized iPresenterPlux operator account.
            </p>

            <div className="mt-8">
              <LoginForm />
            </div>

            <div className="mt-7 border-t border-white/[.06] pt-5 text-center text-[11px] leading-5 text-white/24">
              Live output controls are role-restricted and recorded in the audit trail.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
