import { MonitorPlay, RadioTower, ShieldCheck, Sparkles } from "lucide-react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/[.08] bg-[#0b0f16]/95 shadow-[0_35px_120px_rgba(0,0,0,.45)] lg:grid-cols-[1.15fr_.85fr]">
        <section className="ip-grid hidden min-h-[620px] border-r border-white/[.07] p-10 lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc464]">
              <MonitorPlay size={24} />
            </div>
            <div>
              <div className="text-xl font-black tracking-tight">iPresenterPlux</div>
              <div className="text-[10px] uppercase tracking-[.25em] text-white/35">AI Church Studio</div>
            </div>
          </div>

          <div className="my-auto max-w-lg">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d7a94a]/15 bg-[#d7a94a]/[.06] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.18em] text-[#ddb45e]">
              <Sparkles size={13} />
              Presentation · Broadcast · Interpretation
            </div>
            <h1 className="text-4xl font-black leading-tight tracking-[-.03em]">
              One intelligent control room for the entire service.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-white/45">
              Scripture intelligence, Program and Preview, multilingual congregation channels,
              cameras, livestream destinations and future church operations share one secure platform.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                <RadioTower size={18} className="mb-3 text-[#dfb75d]" />
                <div className="text-sm font-bold">Broadcast-ready</div>
                <div className="mt-1 text-xs leading-5 text-white/35">WebRTC, NDI, SRT and RTMPS architecture.</div>
              </div>
              <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                <ShieldCheck size={18} className="mb-3 text-emerald-300" />
                <div className="text-sm font-bold">Operator security</div>
                <div className="mt-1 text-xs leading-5 text-white/35">Role-aware access and audited live actions.</div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-white/25">Lightworld Technologies · Foundation v0.1.0</div>
        </section>

        <section className="flex min-h-[620px] items-center p-6 sm:p-10">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc464]">
                  <MonitorPlay size={21} />
                </div>
                <div>
                  <div className="font-black">iPresenterPlux</div>
                  <div className="text-[10px] uppercase tracking-[.2em] text-white/35">AI Church Studio</div>
                </div>
              </div>
            </div>

            <div className="mb-7">
              <div className="text-xs font-bold uppercase tracking-[.16em] text-[#d7a94a]">Secure access</div>
              <h2 className="mt-2 text-2xl font-black tracking-tight">Control Room Sign In</h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                Use an authorized church operator account.
              </p>
            </div>

            <LoginForm />

            <div className="mt-6 flex items-center gap-2 text-[11px] leading-5 text-white/25">
              <ShieldCheck size={14} className="shrink-0" />
              Live output actions are logged for operational accountability.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
