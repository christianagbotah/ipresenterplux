"use client";

import { useActionState } from "react";
import { authenticate } from "@/app/login/actions";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

export function LoginForm() {
  const [error, action, pending] = useActionState(authenticate, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="redirectTo" value="/" />

      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[.13em] text-white/45">Email</span>
        <span className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 px-3">
          <Mail size={16} className="text-white/30" />
          <input
            required
            type="email"
            name="email"
            autoComplete="email"
            className="w-full bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-white/20"
            placeholder="you@church.org"
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[.13em] text-white/45">Password</span>
        <span className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 px-3">
          <LockKeyhole size={16} className="text-white/30" />
          <input
            required
            type="password"
            name="password"
            autoComplete="current-password"
            className="w-full bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-white/20"
            placeholder="Enter your password"
          />
        </span>
      </label>

      {error ? (
        <div className="rounded-xl border border-red-400/15 bg-red-400/[.08] px-3 py-2.5 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 py-3.5 text-sm font-black text-[#171107] transition hover:bg-[#e5ba61] disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Open Control Room"}
        {!pending ? <ArrowRight size={16} /> : null}
      </button>
    </form>
  );
}
