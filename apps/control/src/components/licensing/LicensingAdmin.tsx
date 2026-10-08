"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, LoaderCircle, RefreshCw, ShieldBan, Sparkles } from "lucide-react";

type OrganizationOption = { id: string; name: string };
type PlanOption = { id: string; code: string; name: string; defaultDeviceSeatLimit: number };
type KeyItem = { id: string; prefix: string; status: string; activation_limit: number; created_at: string };
type Overview = {
  organizationId: string;
  organizationName: string;
  subscription: null | { id: string; status: string; expiresAt: string | null; graceUntil: string | null; plan: { id: string; code: string; name: string } };
  seats: { limit: number; used: number };
  activations: Array<{ id: string; deviceName: string; platform: string; state: string; lastValidatedAt: string }>;
  audit?: Array<{ id: string; action: string; createdAt: string }>;
};

type ApiResult = { ok?: boolean; error?: string; displayKey?: string; overview?: Overview; keys?: KeyItem[] } & Record<string, unknown>;

export function LicensingAdmin({ organizations, plans }: { organizations: OrganizationOption[]; plans: PlanOption[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [oneTimeKey, setOneTimeKey] = useState("");
  const [activationLimit, setActivationLimit] = useState(1);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [seatLimit, setSeatLimit] = useState(1);

  const selectedOrganization = useMemo(() => organizations.find((item) => item.id === organizationId), [organizations, organizationId]);

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
    const data = await response.json() as ApiResult;
    if (!response.ok) throw new Error(data.error || "Licensing request failed");
    return data;
  }

  async function refresh() {
    if (!organizationId) return;
    setBusy(true);
    setMessage("");
    try {
      const [subscriptionData, keyData] = await Promise.all([
        request(`/api/v1/admin/licensing/subscriptions?organizationId=${encodeURIComponent(organizationId)}`),
        request(`/api/v1/admin/licensing/keys?organizationId=${encodeURIComponent(organizationId)}`)
      ]);
      setOverview((subscriptionData.overview as Overview | undefined) ?? null);
      setKeys((keyData.keys as KeyItem[] | undefined) ?? []);
      const nextLimit = (subscriptionData.overview as Overview | undefined)?.seats.limit;
      if (nextLimit) setSeatLimit(nextLimit);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load licensing data");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, [organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mutate(url: string, payload: Record<string, unknown>, showKey = false) {
    setBusy(true);
    setMessage("");
    try {
      const data = await request(url, { method: "POST", body: JSON.stringify(payload) });
      if (showKey && typeof data.displayKey === "string") setOneTimeKey(data.displayKey);
      setMessage("Licensing change saved and audited.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Licensing change failed");
    } finally {
      setBusy(false);
    }
  }

  async function issueKey() {
    if (!overview?.subscription) return;
    await mutate("/api/v1/admin/licensing/keys", { action: "issue", subscriptionId: overview.subscription.id, activationLimit, note: "Issued from Lightworld licensing console" }, true);
  }

  async function createSubscription() {
    if (!organizationId || !planId) return;
    await mutate("/api/v1/admin/licensing/subscriptions", { action: "create", organizationId, planId, status: "active", deviceSeatLimit: seatLimit });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-white/[.08] bg-[#0d121a] p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[250px] flex-1 text-xs font-bold text-white/45">
            Church organization
            <select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setOneTimeKey(""); }} className="mt-2 h-11 w-full cursor-pointer rounded-xl border border-white/[.08] bg-[#090d13] px-3 text-sm text-white outline-none focus:border-[#d7a94a]/40">
              {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void refresh()} disabled={busy} className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-4 text-sm font-bold transition hover:bg-white/[.07] disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
      </section>

      {oneTimeKey ? (
        <section className="rounded-[24px] border border-amber-300/25 bg-amber-300/[.06] p-5">
          <div className="text-[11px] font-black uppercase tracking-[.18em] text-amber-200">One-time product key</div>
          <div className="mt-3 break-all font-mono text-lg font-black tracking-wider text-amber-50">{oneTimeKey}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-amber-100/55">Copy this key now. Only its non-secret prefix is stored and shown after this response.</p>
            <button type="button" onClick={() => void navigator.clipboard.writeText(oneTimeKey)} className="flex cursor-pointer items-center gap-2 rounded-xl bg-amber-200 px-3 py-2 text-xs font-black text-[#171109]"><Copy size={14} /> Copy key</button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-[24px] border border-white/[.08] bg-[#0d121a] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]">Commercial authority</div>
              <h2 className="mt-1 text-xl font-black">{selectedOrganization?.name ?? "Organization"}</h2>
            </div>
            <Sparkles size={18} className="text-[#d7a94a]" />
          </div>
          {overview?.subscription ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white/[.025] p-4"><div className="text-[10px] uppercase tracking-[.14em] text-white/30">Plan</div><div className="mt-2 font-black">{overview.subscription.plan.name}</div></div>
                <div className="rounded-2xl bg-white/[.025] p-4"><div className="text-[10px] uppercase tracking-[.14em] text-white/30">Status</div><div className="mt-2 font-black capitalize">{overview.subscription.status}</div></div>
                <div className="rounded-2xl bg-white/[.025] p-4"><div className="text-[10px] uppercase tracking-[.14em] text-white/30">Seats</div><div className="mt-2 font-black">{overview.seats.used} / {overview.seats.limit}</div></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["active", "suspended", "past_due"] as const).map((status) => (
                  <button key={status} type="button" disabled={busy || overview.subscription?.status === status} onClick={() => void mutate("/api/v1/admin/licensing/subscriptions", { action: "set_status", subscriptionId: overview.subscription?.id, status, reason: "Changed from Lightworld licensing console" })} className="cursor-pointer rounded-xl border border-white/[.08] px-3 py-2 text-xs font-bold capitalize transition hover:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-35">{status.replaceAll("_", " ")}</button>
                ))}
                <button type="button" disabled={busy} onClick={() => void mutate("/api/v1/admin/licensing/subscriptions", { action: "extend", subscriptionId: overview.subscription?.id, days: 30, reason: "30-day extension from Lightworld licensing console" })} className="cursor-pointer rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.06] px-3 py-2 text-xs font-bold text-[#efc76e]">Extend 30 days</button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-bold text-white/40">Seat limit<input type="number" min={1} value={seatLimit} onChange={(event) => setSeatLimit(Number(event.target.value))} className="mt-2 h-10 w-28 rounded-xl border border-white/[.08] bg-[#090d13] px-3 text-white" /></label>
                <button type="button" disabled={busy} onClick={() => void mutate("/api/v1/admin/licensing/subscriptions", { action: "set_seats", subscriptionId: overview.subscription?.id, seatLimit })} className="h-10 cursor-pointer rounded-xl border border-white/[.08] px-3 text-xs font-bold">Save seats</button>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-white/[.1] p-5">
              <div className="text-sm font-bold">No current subscription</div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="min-w-[220px] flex-1 text-xs font-bold text-white/40">Plan<select value={planId} onChange={(event) => setPlanId(event.target.value)} className="mt-2 h-10 w-full cursor-pointer rounded-xl border border-white/[.08] bg-[#090d13] px-3 text-white">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
                <label className="text-xs font-bold text-white/40">Seats<input type="number" min={1} value={seatLimit} onChange={(event) => setSeatLimit(Number(event.target.value))} className="mt-2 h-10 w-24 rounded-xl border border-white/[.08] bg-[#090d13] px-3 text-white" /></label>
                <button type="button" onClick={() => void createSubscription()} disabled={busy || !planId} className="h-10 cursor-pointer rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#171109] disabled:opacity-40">Create subscription</button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-white/[.08] bg-[#0d121a] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><KeyRound size={14} /> Product keys</div>
          {overview?.subscription ? (
            <div className="mt-4 flex items-end gap-2">
              <label className="text-xs font-bold text-white/40">Activation limit<input type="number" min={1} value={activationLimit} onChange={(event) => setActivationLimit(Number(event.target.value))} className="mt-2 h-10 w-28 rounded-xl border border-white/[.08] bg-[#090d13] px-3 text-white" /></label>
              <button type="button" onClick={() => void issueKey()} disabled={busy} className="h-10 cursor-pointer rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#171109]">Issue key</button>
            </div>
          ) : null}
          <div className="mt-5 space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="rounded-2xl border border-white/[.06] bg-white/[.02] p-3">
                <div className="flex items-center justify-between gap-3"><code className="text-xs font-bold text-white/75">{key.prefix}••••</code><span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{key.status}</span></div>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy || key.status !== "active"} onClick={() => void mutate("/api/v1/admin/licensing/keys", { action: "reset", productKeyId: key.id }, true)} className="cursor-pointer rounded-lg border border-white/[.08] px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-35">Reset</button>
                  <button type="button" disabled={busy || key.status === "revoked"} onClick={() => void mutate("/api/v1/admin/licensing/keys", { action: "revoke", productKeyId: key.id, reason: "Revoked from Lightworld licensing console" })} className="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-300/15 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 disabled:opacity-35"><ShieldBan size={12} /> Revoke</button>
                </div>
              </div>
            ))}
            {!keys.length ? <div className="py-8 text-center text-sm text-white/30">No keys issued for this church.</div> : null}
          </div>
        </div>
      </section>

      {message ? <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-sm text-white/60">{message}</div> : null}
    </div>
  );
}
