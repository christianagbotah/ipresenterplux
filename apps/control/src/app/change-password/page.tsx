import { KeyRound, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-[28px] border border-white/[.08] bg-[#0b0f16] p-6 shadow-[0_35px_120px_rgba(0,0,0,.45)] sm:p-9">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc464]">
          <KeyRound size={22} />
        </div>
        <div className="mt-6 text-xs font-bold uppercase tracking-[.16em] text-[#d7a94a]">
          Account security
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-tight">
          {session.user.forcePasswordChange ? "Create your private password" : "Change your password"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-white/40">
          {session.user.forcePasswordChange
            ? "The temporary bootstrap password cannot be used for Control Room actions. Replace it before continuing."
            : "Changing your password signs out this session so you can verify the new credentials."}
        </p>

        <div className="mt-7">
          <ChangePasswordForm />
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-3 text-[11px] leading-5 text-white/30">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-300" />
          Passwords are stored as one-way bcrypt hashes. iPresenterPlux never stores the plain password.
        </div>
      </section>
    </main>
  );
}
