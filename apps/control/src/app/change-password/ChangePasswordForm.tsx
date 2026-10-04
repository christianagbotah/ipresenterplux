"use client";

import { useActionState } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [error, action, pending] = useActionState(changePassword, undefined);

  const fieldClass =
    "h-12 w-full rounded-xl border border-white/[.08] bg-white/[.035] px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#d7a94a]/35";

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[.15em] text-white/40">
          Current password
        </label>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          className={fieldClass}
          placeholder="Enter your current password"
        />
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[.15em] text-white/40">
          New password
        </label>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={fieldClass}
          placeholder="At least 12 characters"
        />
        <p className="mt-2 text-[11px] leading-5 text-white/30">
          Include uppercase, lowercase and a number.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[.15em] text-white/40">
          Confirm new password
        </label>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={fieldClass}
          placeholder="Repeat the new password"
        />
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
        {pending ? <LockKeyhole size={16} /> : <KeyRound size={16} />}
        {pending ? "Updating password…" : "Change password"}
      </button>
    </form>
  );
}
