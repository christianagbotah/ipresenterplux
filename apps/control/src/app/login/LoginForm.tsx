"use client";

import { useActionState } from "react";
import { LockKeyhole, LogIn, Mail } from "lucide-react";
import { authenticate } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(authenticate, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[.15em] text-white/40">
          Email
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.035] px-3">
          <Mail size={16} className="text-white/30" />
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/20"
            placeholder="operator@church.org"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[.15em] text-white/40">
          Password
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.035] px-3">
          <LockKeyhole size={16} className="text-white/30" />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/20"
            placeholder="Enter your password"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/15 bg-red-400/[.07] px-3 py-2.5 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#d7a94a] text-sm font-black text-[#171109] transition hover:bg-[#e6ba5e] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogIn size={16} />
        {pending ? "Signing in…" : "Sign in to Control Room"}
      </button>
    </form>
  );
}
