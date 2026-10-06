"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { ChevronDown, LockKeyhole, LogIn, Mail, UsersRound } from "lucide-react";
import { authenticate } from "./actions";
import { resolveDemoAccount, type DemoAccount } from "@/lib/demo-login";

type LoginFormProps = {
  demoAccounts?: DemoAccount[];
};

export function LoginForm({ demoAccounts = [] }: LoginFormProps) {
  const [error, action, pending] = useActionState(authenticate, undefined);
  const [selectedRole, setSelectedRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const selectedDemo = resolveDemoAccount(demoAccounts, selectedRole);

  function handleDemoChange(event: ChangeEvent<HTMLSelectElement>) {
    const roleId = event.target.value;
    setSelectedRole(roleId);
    const account = resolveDemoAccount(demoAccounts, roleId);
    if (!account) return;
    setEmail(account.email);
    setPassword(account.password);
  }

  return (
    <form action={action} className="space-y-4">
      {demoAccounts.length ? (
        <div className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.055] p-3.5">
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.15em] text-[#e3bd6a]">
            <UsersRound size={15} />
            Demo account
          </label>
          <div className="relative">
            <select
              value={selectedRole}
              onChange={handleDemoChange}
              className="h-12 w-full appearance-none rounded-xl border border-white/[.09] bg-[#0d1118] px-3 pr-10 text-sm font-semibold text-white outline-none transition focus:border-[#d7a94a]/50"
              aria-label="Choose a demo account"
            >
              <option value="">Choose a demo role…</option>
              {demoAccounts.map((account) => (
                <option key={account.roleId} value={account.roleId}>
                  {account.label}{account.futureModule ? " · Future module" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/35" />
          </div>
          {selectedDemo ? (
            <div className="mt-2.5 rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-white/75">{selectedDemo.label}</span>
                {selectedDemo.futureModule ? (
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/[.08] px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] text-amber-200">
                    Module in progress
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-white/40">{selectedDemo.description}</div>
              <div className="mt-1 truncate text-[11px] font-semibold text-[#d7a94a]">{selectedDemo.email}</div>
            </div>
          ) : (
            <div className="mt-2 text-[10px] leading-4 text-white/35">
              Choose a role to fill its demo credentials automatically. You can still enter another account manually.
            </div>
          )}
        </div>
      ) : null}

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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
